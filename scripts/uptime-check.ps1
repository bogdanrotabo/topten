# Checks both live sites and appends a line to the log ONLY when something is wrong.
#
# A healthy check writes nothing. That matters: the log is meant to answer the
# question "was it actually down?", and a file full of "OK" lines answers it badly.
#
# Two separate assertions per site, because the failure that actually bit us was
# not the site being down:
#
#   1. http:// must answer with a redirect to https://. On 25 Aug 2026 Cloudflare
#      served topten.one over plain http with a 200, and mobile Chrome refused it
#      as insecure while every uptime check in the world would have stayed green.
#   2. https:// must answer 200 in reasonable time.
#
# The redirect is checked with AllowAutoRedirect disabled and the Location header
# read directly. Invoke-WebRequest cannot be used for this: in Windows PowerShell
# 5.1 it follows the redirect but still reports ResponseUri as the original http
# URL, which made the first version of this script cry wolf twice.
#
# Registered as a Windows Scheduled Task every 5 minutes, so it keeps working
# whether or not Claude Code is open.

$ErrorActionPreference = 'Stop'
$log = Join-Path $env:USERPROFILE 'Documents\TopTen\uptime.log'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$sites = @('topten.one', 'rotabo.app')

function Write-Problem($name, $kind, $detail) {
  $stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  Add-Content -Path $script:log -Encoding utf8 -Value "$stamp  $name  $kind  $detail"
}

foreach ($name in $sites) {

  # --- 1. does http:// send us to https:// ? ---------------------------------
  try {
    $req = [Net.HttpWebRequest]::Create("http://$name/")
    $req.AllowAutoRedirect = $false
    $req.Timeout = 20000
    $req.UserAgent = 'TopTen-uptime/1'
    $resp = $req.GetResponse()
    $code = [int]$resp.StatusCode
    $loc  = $resp.Headers['Location']
    $resp.Close()

    if ($code -lt 300 -or $code -ge 400) {
      Write-Problem $name 'NO-HTTPS' "http a raspuns $code in loc de redirect"
    }
    elseif (-not $loc -or -not $loc.StartsWith('https://')) {
      Write-Problem $name 'NO-HTTPS' "redirect catre '$loc'"
    }
  }
  catch {
    $m = $_.Exception.Message -replace '\s+', ' '
    if ($m.Length -gt 140) { $m = $m.Substring(0, 140) }
    Write-Problem $name 'DOWN-HTTP' $m
  }

  # --- 2. does https:// serve the page ? -------------------------------------
  try {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $r = Invoke-WebRequest -Uri "https://$name/" -TimeoutSec 25 -UseBasicParsing
    $sw.Stop()

    if ($r.StatusCode -ne 200) {
      Write-Problem $name 'FAIL' "https a raspuns $($r.StatusCode)"
    }
    elseif ($r.RawContentLength -lt 500) {
      # A 200 carrying almost nothing is a broken deploy, not a healthy site.
      Write-Problem $name 'EMPTY' "$($r.RawContentLength) octeti"
    }
    elseif ($sw.Elapsed.TotalSeconds -gt 10) {
      Write-Problem $name 'SLOW' ("{0:N1}s" -f $sw.Elapsed.TotalSeconds)
    }
  }
  catch {
    $m = $_.Exception.Message -replace '\s+', ' '
    if ($m.Length -gt 140) { $m = $m.Substring(0, 140) }
    Write-Problem $name 'DOWN' $m
  }
}

# Keep the log from growing without bound; a month of incidents is plenty.
if ((Test-Path $log) -and ((Get-Item $log).Length -gt 200KB)) {
  Set-Content -Path $log -Value (Get-Content $log -Tail 2000) -Encoding utf8
}
