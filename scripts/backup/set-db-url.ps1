# Saves the Neon database URL for backup.ps1, encrypted with Windows DPAPI (only this Windows user on
# this PC can decrypt it). Run it again after rotating the Neon password.
# Usage: powershell -ExecutionPolicy Bypass -File set-db-url.ps1   (paste the URL when asked; it is not shown)
$dir = Join-Path $env:LOCALAPPDATA 'JournalBackup'
New-Item -ItemType Directory -Force $dir | Out-Null
$sec = Read-Host 'Paste the Neon DATABASE_URL (postgresql://...)' -AsSecureString
$sec | ConvertFrom-SecureString | Set-Content -Path (Join-Path $dir 'dburl.sec') -Encoding ascii
Write-Output "Saved (encrypted) to $dir\dburl.sec"
