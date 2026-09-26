param(
  [Parameter(Mandatory = $true)]
  [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
$certificatePasswordText = 'CineLocal-HTTPS-Local'

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

$pfxPath = Join-Path $OutputDirectory 'cinelocal.pfx'
$certificatePath = Join-Path $OutputDirectory 'cinelocal.crt'
$signaturePath = Join-Path $OutputDirectory 'addresses.txt'

$lanAddresses = @()
try {
  $lanAddresses = @(
    Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object {
        $_.IPAddress -ne '127.0.0.1' -and
        $_.IPAddress -notlike '169.254.*'
      } |
      Select-Object -ExpandProperty IPAddress
  )
} catch {
  $lanAddresses = @()
}

$lanAddresses = @($lanAddresses | Sort-Object -Unique)
$signature = $lanAddresses -join ','
$needsNewCertificate = -not (Test-Path -LiteralPath $pfxPath) -or
  -not (Test-Path -LiteralPath $certificatePath) -or
  -not (Test-Path -LiteralPath $signaturePath) -or
  ((Get-Content -LiteralPath $signaturePath -Raw -ErrorAction SilentlyContinue).Trim() -ne $signature)

if (-not $needsNewCertificate) {
  Write-Host "[HTTPS] Certificado local pronto: $pfxPath"
  exit 0
}

Write-Host '[HTTPS] Gerando certificado local para localhost e enderecos da rede...'
$rsa = [System.Security.Cryptography.RSA]::Create(2048)
$certificate = $null
try {
  $distinguishedName = [System.Security.Cryptography.X509Certificates.X500DistinguishedName]::new('CN=CineLocal')
  $request = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new(
    $distinguishedName,
    $rsa,
    [System.Security.Cryptography.HashAlgorithmName]::SHA256,
    [System.Security.Cryptography.RSASignaturePadding]::Pkcs1
  )

  $sanBuilder = [System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
  $sanBuilder.AddDnsName('localhost')
  $sanBuilder.AddIpAddress([System.Net.IPAddress]::Parse('127.0.0.1'))
  foreach ($address in $lanAddresses) {
    $sanBuilder.AddIpAddress([System.Net.IPAddress]::Parse($address))
  }
  $request.CertificateExtensions.Add($sanBuilder.Build($false))

  $certificate = $request.CreateSelfSigned(
    [System.DateTimeOffset]::Now.AddMinutes(-5),
    [System.DateTimeOffset]::Now.AddYears(3)
  )

  $pfxBytes = $certificate.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx, $certificatePasswordText)
  [System.IO.File]::WriteAllBytes($pfxPath, $pfxBytes)
  $certificateBytes = $certificate.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert)
  [System.IO.File]::WriteAllBytes($certificatePath, $certificateBytes)
  Set-Content -LiteralPath $signaturePath -Value $signature -Encoding UTF8

  # Do not modify certificate trust stores automatically. The .crt file can
  # be installed manually on devices that need to trust this local HTTPS site.
} finally {
  if ($certificate) { $certificate.Dispose() }
  if ($rsa) { $rsa.Dispose() }
}

Write-Host "[HTTPS] Certificado criado em $certificatePath"
Write-Host '[HTTPS] Para o celular, instale esse arquivo como certificado CA antes de abrir o endereco HTTPS.'
