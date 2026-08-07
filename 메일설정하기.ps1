$smtpUser = Read-Host -Prompt 'Enter sender Gmail address'
$smtpPassword = Read-Host -Prompt 'Enter Gmail app password (16 characters)' -AsSecureString
$bstr = [IntPtr]::Zero
try {
  if ([string]::IsNullOrWhiteSpace($smtpUser) -or $null -eq $smtpPassword) { throw 'Gmail address and app password are required.' }
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($smtpPassword)
  $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  [Environment]::SetEnvironmentVariable('GMAIL_SMTP_USER', $smtpUser, 'User')
  [Environment]::SetEnvironmentVariable('GMAIL_SMTP_APP_PASSWORD', $plainPassword, 'User')
  Write-Host 'Mail settings saved. Restart the application using the batch file.'
} finally {
  if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  Remove-Variable plainPassword -ErrorAction SilentlyContinue
}
