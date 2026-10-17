<#
Coleta a configuração de ambiente que a subseção de reprodutibilidade do TCC precisa declarar:
versão do LM Studio, motor de inferência em uso, identidade dos modelos carregados (arquivo,
quantização, contexto, SHA-256 dos pesos) e o hardware da máquina.

Rode na máquina que vai executar a avaliação, com o LM Studio aberto e o servidor local ligado.

  powershell -ExecutionPolicy Bypass -File scripts\coletar-ambiente.ps1
  ... -SkipHash                      # pula o SHA-256 dos pesos (lê ~2 GB por modelo carregado)
  ... -OutDir caminho\de\saida       # padrão: evaluation\notebooks\data\results
  ... -ServerUrl http://localhost:1234

Escreve ambiente.json (registro completo) e ambiente.md (tabela pronta para o texto) no OutDir,
e imprime a tabela no terminal. Nenhum dado de prontuário é lido ou gravado: só configuração.
Item que o script não consegue ver sai como "não detectado" — ele nunca interrompe a coleta.
#>
param(
    [string]$OutDir = "evaluation\notebooks\data\results",
    [string]$ServerUrl = "http://localhost:1234",
    [switch]$SkipHash
)

$ErrorActionPreference = "Continue"

function Probe {
    param([scriptblock]$Block)
    try {
        $value = & $Block
        if ($null -eq $value -or "$value".Trim() -eq "") { return "não detectado" }
        return $value
    } catch {
        $first = $_.Exception.Message -split "`n" | Select-Object -First 1
        return "não detectado ($first)"
    }
}

function Find-Lms {
    $onPath = Get-Command lms -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }
    $bundled = Join-Path $env:USERPROFILE ".lmstudio\bin\lms.exe"
    if (Test-Path $bundled) { return $bundled }
    return $null
}

$lms = Find-Lms
Write-Host "Coletando ambiente..." -ForegroundColor Cyan

# --- LM Studio: versão do aplicativo -------------------------------------------------------------
$lmStudioVersion = Probe {
    $keys = @(
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
    )
    $found = Get-ItemProperty $keys -ErrorAction SilentlyContinue |
             Where-Object { $_.DisplayName -like "*LM Studio*" } |
             Select-Object -First 1
    if ($found) { return "$($found.DisplayName) $($found.DisplayVersion)" }
    # Sem registro: cai para a versão do próprio executável.
    $exe = Get-ChildItem (Join-Path $env:LOCALAPPDATA "Programs") -Recurse -Filter "LM Studio.exe" `
           -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($exe) { return "LM Studio $($exe.VersionInfo.ProductVersion)" }
    return $null
}

# --- Motor de inferência: a linha marcada com ✓ em `lms runtime ls` -------------------------------
$runtimeRaw = Probe { if ($lms) { (& $lms runtime ls 2>&1) -join "`n" } else { $null } }
$engine = Probe {
    if ("$runtimeRaw".StartsWith("não detectado")) { return $null }
    $selected = "$runtimeRaw" -split "`n" | Where-Object { $_ -match "✓" } | Select-Object -First 1
    if (-not $selected) { return $null }
    # A primeira coluna é o nome do motor, com a versão após o @.
    return ($selected -split "\s{2,}" | Where-Object { $_ -match "@" } | Select-Object -First 1).Trim()
}

# --- Modelos carregados ---------------------------------------------------------------------------
$models = Probe {
    if (-not $lms) { return $null }
    $json = (& $lms ps --json 2>&1) -join "`n"
    $parsed = $json | ConvertFrom-Json
    if (-not $parsed) { return $null }
    @($parsed) | ForEach-Object {
        $file = Join-Path $env:USERPROFILE (Join-Path ".lmstudio\models" $_.path)
        $hash = "não calculado (-SkipHash)"
        if (-not $SkipHash) {
            $hash = if (Test-Path $file) {
                Write-Host "  SHA-256 de $($_.identifier)... (lê o arquivo inteiro)" -ForegroundColor DarkGray
                (Get-FileHash $file -Algorithm SHA256).Hash
            } else { "arquivo não encontrado em $file" }
        }
        [ordered]@{
            identificador  = $_.identifier
            arquivo        = $_.path
            tamanho_bytes  = $_.sizeBytes
            arquitetura    = $_.architecture
            quantizacao    = "$($_.quantization.name) ($($_.quantization.bits) bits)"
            contexto       = $_.contextLength
            contexto_max   = $_.maxContextLength
            slots_paralelos = $_.parallel
            status         = $_.status
            sha256         = $hash
        }
    }
}

$apiModels = Probe {
    $response = Invoke-RestMethod -Uri "$ServerUrl/api/v0/models" -TimeoutSec 15
    @($response.data) | Where-Object { $_.state -eq "loaded" } | ForEach-Object {
        [ordered]@{
            id = $_.id; quantizacao = $_.quantization
            contexto_carregado = $_.loaded_context_length; contexto_max = $_.max_context_length
        }
    }
}

# --- Hardware e sistema ---------------------------------------------------------------------------
$cpu = Probe {
    $c = Get-CimInstance Win32_Processor | Select-Object -First 1
    "$($c.Name.Trim()) — $($c.NumberOfCores) núcleos / $($c.NumberOfLogicalProcessors) threads @ $($c.MaxClockSpeed) MHz"
}
$ram = Probe {
    "{0} GB" -f [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1)
}
$gpu = Probe {
    # nvidia-smi é confiável; o AdapterRAM do WMI estoura acima de 4 GB e reporta valor errado.
    $smi = & nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader 2>$null
    if ($LASTEXITCODE -eq 0 -and $smi) { return ($smi -join "; ") }
    (Get-CimInstance Win32_VideoController |
        ForEach-Object { "$($_.Name) (driver $($_.DriverVersion), VRAM pelo WMI não confiável)" }) -join "; "
}
$os = Probe {
    $o = Get-CimInstance Win32_OperatingSystem
    "$($o.Caption) $($o.Version) (build $($o.BuildNumber)), $($o.OSArchitecture)"
}

# --- Stack do projeto -----------------------------------------------------------------------------
$commit = Probe { (& git rev-parse --short HEAD 2>&1) | Select-Object -First 1 }
$dockerVersion = Probe { (& docker version --format '{{.Server.Version}}' 2>&1) | Select-Object -First 1 }
$workerDecoding = Probe {
    $out = & docker compose exec -T worker printenv AI_TEMPERATURE AI_TOP_K AI_TOP_P LMSTUDIO_URL LLM_SEED 2>&1
    if ($LASTEXITCODE -ne 0) { return $null }
    ($out | Where-Object { $_ }) -join " | "
}

$report = [ordered]@{
    coletado_em        = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss zzz")
    maquina            = $env:COMPUTERNAME
    lm_studio          = $lmStudioVersion
    motor_inferencia   = $engine
    motor_lista_bruta  = $runtimeRaw
    modelos_carregados = $models
    modelos_pela_api   = $apiModels
    cpu                = $cpu
    memoria            = $ram
    gpu                = $gpu
    sistema            = $os
    commit_repositorio = $commit
    docker             = $dockerVersion
    worker_decodificacao = $workerDecoding
}

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }
$jsonPath = Join-Path $OutDir "ambiente.json"
$mdPath = Join-Path $OutDir "ambiente.md"
$report | ConvertTo-Json -Depth 6 | Set-Content -Path $jsonPath -Encoding UTF8

$lines = @(
    "# Ambiente de execução",
    "",
    "Coletado em $($report.coletado_em) na máquina ``$($report.maquina)``.",
    "",
    "| Item | Valor |",
    "| --- | --- |",
    "| Semente | 42 (declarada pelo notebook) |",
    "| Decodificação | ``temperature = 0``, ``top_k = 1``, ``top_p = 1`` |",
    "| Rota de inferência | ``POST /v1/chat/completions`` |",
    "| Motor de inferência | $($report.motor_inferencia) |",
    "| LM Studio | $($report.lm_studio) |",
    "| CPU / memória | $($report.cpu) / $($report.memoria) |",
    "| GPU / driver | $($report.gpu) |",
    "| Sistema operacional | $($report.sistema) |",
    "| Docker | $($report.docker) |",
    "| Commit do repositório | $($report.commit_repositorio) |",
    "| Limite de texto enviado ao modelo | 6000 caracteres |",
    ""
)
foreach ($m in @($report.modelos_carregados)) {
    if ($m -is [string]) { $lines += "> Modelos carregados: $m"; $lines += ""; continue }
    $lines += @(
        "## Modelo ``$($m.identificador)``",
        "",
        "| Item | Valor |",
        "| --- | --- |",
        "| Arquivo GGUF | ``$($m.arquivo)`` |",
        "| SHA-256 dos pesos | ``$($m.sha256)`` |",
        "| Quantização | $($m.quantizacao) |",
        "| Arquitetura | $($m.arquitetura) |",
        "| Contexto carregado / máximo | $($m.contexto) / $($m.contexto_max) |",
        "| Slots paralelos | $($m.slots_paralelos) |",
        ""
    )
}
$lines += @(
    "> As camadas em GPU (*GPU Offload*) não são expostas por nenhum comando: veja na interface do",
    "> LM Studio, em *My Models* -> o modelo -> painel de carregamento, e anote aqui. Alterar esse",
    "> número altera as contas e pode quebrar a igualdade byte a byte entre execuções.",
    ""
)
$lines -join "`r`n" | Set-Content -Path $mdPath -Encoding UTF8

Write-Host ""
Write-Host ($lines -join "`n")
Write-Host "Gravado em:" -ForegroundColor Cyan
Write-Host "  $jsonPath"
Write-Host "  $mdPath"
