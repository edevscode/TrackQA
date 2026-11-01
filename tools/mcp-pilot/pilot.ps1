param(
    [ValidateSet('Prepare', 'Auth', 'Issue', 'Cleanup')][string]$Mode = 'Prepare',
    [string]$ProjectId = '5a759e3f-50b4-4fdd-b8ad-43469a7100c0',
    [ValidateSet('Google', 'Password')][string]$AuthProvider = 'Google',
    [switch]$ApprovedRemoteChanges,
    [switch]$StorageReviewed,
    [switch]$FixtureReviewed
)
$ErrorActionPreference = 'Stop'
$options = $null
$process = $null
$operationLock = $null
$workspace = Join-Path $env:LOCALAPPDATA 'TrackQA-MCP-Pilot'
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$allowed = @($sid, 'S-1-5-18', 'S-1-5-32-544')

function Assert-PrivatePath([string]$Path) {
    $item = Get-Item -LiteralPath $Path -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse point refused.' }
    $acl = Get-Acl -LiteralPath $Path
    $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
    if ($owner -notin $allowed) { throw 'Unexpected owner.' }
    foreach ($rule in $acl.Access) {
        $principal = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
        if ($rule.AccessControlType -ne 'Allow' -or $principal -notin $allowed) {
            throw 'Unexpected ACL entry; review manually. No ACLs were changed.'
        }
    }
}

function Read-Masked([string]$Prompt) {
    $value = Read-Host $Prompt -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($value)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $value.Dispose() }
}

try {
    Assert-PrivatePath $env:LOCALAPPDATA
    if (([IO.DriveInfo]::new([IO.Path]::GetPathRoot($workspace))).DriveType -ne 'Fixed') { throw 'Local fixed drive required.' }
    foreach ($cloudRoot in @($env:OneDrive, $env:OneDriveConsumer, $env:OneDriveCommercial)) {
        if ($cloudRoot -and $workspace.StartsWith($cloudRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Known synchronized location refused.'
        }
    }
    if ($Mode -eq 'Prepare') {
        # Atomic fail-if-exists directory creation using the Windows API. Never
        # overwrite or trust a preexisting unexpected workspace.
        Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class PilotDirectory {
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
 public static extern bool CreateDirectory(string path, IntPtr securityAttributes);
}
'@
        if (-not [PilotDirectory]::CreateDirectory($workspace, [IntPtr]::Zero)) { throw 'Workspace creation refused; path exists or creation failed.' }
        Assert-PrivatePath $workspace
        $agents = Join-Path $workspace '.agents'
        if (-not [PilotDirectory]::CreateDirectory($agents, [IntPtr]::Zero)) { throw 'Config directory creation refused.' }
        Assert-PrivatePath $agents
        # Actual read/write/delete check for the execution account, in addition
        # to the conservative ACL allow-list above.
        $probe = Join-Path $workspace ('permission-probe-' + [guid]::NewGuid())
        $stream = [IO.File]::Open($probe, 'CreateNew', 'ReadWrite', 'None')
        try { $stream.WriteByte(42); $stream.Position = 0; if ($stream.ReadByte() -ne 42) { throw 'Access probe failed.' } }
        finally { $stream.Dispose(); Remove-Item -LiteralPath $probe -Force }
    } else {
        if ($Mode -ne 'Auth' -and -not $ApprovedRemoteChanges) { throw 'Issue/Cleanup require separate explicit remote-change approval.' }
        if ($Mode -eq 'Issue' -and (-not $StorageReviewed -or -not $FixtureReviewed)) { throw 'Storage and synthetic fixture review required.' }
        Assert-PrivatePath $workspace
        Assert-PrivatePath (Join-Path $workspace '.agents')
        Assert-PrivatePath (Join-Path $workspace 'pilot-state.json')
        $config = Join-Path $workspace '.agents/mcp_config.json'
        if (Test-Path -LiteralPath $config) { Assert-PrivatePath $config }
    }
    # One supported launcher at a time. Windows releases the exclusive handle on
    # process termination; the empty file is nonsecret and need not be deleted.
    $lockPath = Join-Path $workspace 'pilot-operation.lock'
    if (Test-Path -LiteralPath $lockPath) { Assert-PrivatePath $lockPath }
    $operationLock = [IO.File]::Open($lockPath, 'OpenOrCreate', 'ReadWrite', 'None')
    if ($Mode -eq 'Cleanup') {
        $record = Get-Content -LiteralPath (Join-Path $workspace 'pilot-state.json') -Raw | ConvertFrom-Json
        if ($record.marker -ne 'trackqa-antigravity-pilot-v1') { throw 'Unknown recovery record.' }
        # Remove the local credential before prompting: expired/missing Auth
        # must never prevent local removal. The worker verifies remote state.
        if (Test-Path -LiteralPath $config) {
            try { Remove-Item -LiteralPath $config -Force }
            catch { Write-Warning 'Local removal failed; remote cleanup must still be attempted.' }
        }
    }
    $options = @{ mode = $Mode; projectId = $ProjectId; authProvider = $AuthProvider.ToLowerInvariant(); storageReviewed = [bool]$StorageReviewed; fixtureReviewed = [bool]$FixtureReviewed }
    if ($Mode -ne 'Prepare') {
        $projectRoot = Split-Path (Split-Path $PSScriptRoot)
        foreach ($line in [IO.File]::ReadAllLines((Join-Path $projectRoot '.env'))) {
            if ($line -match '^\s*VITE_SUPABASE_URL\s*=') { $options.supabaseUrl = $line.Substring($line.IndexOf('=') + 1).Trim().Trim([char[]]@([char]34,[char]39)) }
            if ($line -match '^\s*VITE_SUPABASE_ANON_KEY\s*=') { $options.publicApiKey = $line.Substring($line.IndexOf('=') + 1).Trim().Trim([char[]]@([char]34,[char]39)) }
        }
        if ($options.supabaseUrl) { $options.supabaseUrl = $options.supabaseUrl.TrimEnd('/') }
        if ($options.supabaseUrl -ne 'https://mzeuimqfrswrwoaqjdmp.supabase.co' -or -not $options.publicApiKey) { throw 'Existing public Auth configuration unavailable or target differs.' }
        if ($AuthProvider -eq 'Password') {
            $options.email = Read-Masked 'Existing TrackQA Owner email (hidden; never enter credentials in chat)'
            $options.password = Read-Masked 'Existing TrackQA password (hidden; cancel for Google-only login or unsupported MFA)'
        }
    }
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = (Get-Command node -CommandType Application).Source
    $start.Arguments = '"' + (Join-Path $PSScriptRoot 'pilot.mjs') + '"'
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    # Do not inherit Node preload/proxy/debug configuration or database secrets.
    $start.EnvironmentVariables.Clear()
    foreach ($name in @('SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'LOCALAPPDATA')) {
        $value = [Environment]::GetEnvironmentVariable($name)
        if ($value) { $start.EnvironmentVariables[$name] = $value }
    }
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $start
    [void]$process.Start()
    # Keep secret values out of PowerShell command/pipeline parameter logging.
    Add-Type -AssemblyName System.Web.Extensions
    $serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
    $process.StandardInput.Write($serializer.Serialize($options))
    $process.StandardInput.Close()
    $options.Clear()
    $waitMilliseconds = if ($AuthProvider -eq 'Google') { 420000 } else { 90000 }
    if (-not $process.WaitForExit($waitMilliseconds)) { $process.Kill(); throw 'Helper timed out. Outcome uncertain: run Cleanup; do not issue again.' }
    # The worker emits metadata/fixed errors only; never forward raw stderr.
    $output = $process.StandardOutput.ReadToEnd()
    if ($Mode -eq 'Auth') {
        # Persist only this exact metadata schema so the supervisor can verify
        # the result without reading the terminal or capturing credential input.
        $auth = $output | ConvertFrom-Json
        $codes = @('ok','configuration','invalid_credentials','email_not_confirmed','captcha_required','rate_limited','mfa_required','identity_unverified','profile_required','owner_membership_required','project_mismatch','verification_failed','authentication_failed','transport','response_limit','session_signout_failed','interrupted','callback_port_in_use','callback_unavailable','callback_timeout','callback_rejected','oauth_denied','oauth_failed','browser_open_failed')
        if ($auth.code -notin $codes -or $auth.projectId -ne '5a759e3f-50b4-4fdd-b8ad-43469a7100c0' -or $auth.ok -isnot [bool] -or $auth.ownerVerified -isnot [bool] -or $auth.profileVerified -isnot [bool] -or ($null -ne $auth.sessionSignedOut -and $auth.sessionSignedOut -isnot [bool])) { throw 'Invalid sanitized authentication result.' }
        $sanitized = @{ok=$auth.ok;code=$auth.code;projectId=$auth.projectId;ownerVerified=$auth.ownerVerified;profileVerified=$auth.profileVerified;sessionSignedOut=$auth.sessionSignedOut}
        $resultPath = Join-Path $workspace 'owner-auth-result.json'
        if (Test-Path -LiteralPath $resultPath) { Assert-PrivatePath $resultPath }
        [IO.File]::WriteAllText($resultPath, $serializer.Serialize($sanitized), [Text.UTF8Encoding]::new($false))
        Assert-PrivatePath $resultPath
        Write-Output $serializer.Serialize($sanitized)
        if ($process.ExitCode -ne 0) { throw 'Owner sign-in verification failed. See only the allow-listed result code; no automatic retry.' }
    }
    if ($process.ExitCode -ne 0) { throw 'Helper failed. Run Cleanup; retain recovery record. No automatic retry.' }
    if ($Mode -ne 'Auth') { Write-Output $output.Trim() }
    Assert-PrivatePath (Join-Path $workspace 'pilot-state.json')
    $config = Join-Path $workspace '.agents/mcp_config.json'
    if (Test-Path -LiteralPath $config) { Assert-PrivatePath $config }
} finally {
    if ($options) { $options.Clear() }
    if ($process) {
        if (-not $process.HasExited) { $process.Kill() }
        $process.Dispose()
    }
    if ($operationLock) { $operationLock.Dispose() }
}
