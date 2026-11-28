$ErrorActionPreference = 'Stop'
$cfg = @{}
Get-Content 'D:\Cursor\Global\pancake\.env' | Where-Object { $_ -match '^\s*([^#=]+)=(.*)$' } | ForEach-Object {
  $cfg[$Matches[1].Trim()] = $Matches[2].Trim()
}
$ApiKey = $cfg['PANCAKE_API_KEY']
$ShopId = $cfg['PANCAKE_SHOP_ID']
Add-Type -AssemblyName System.Web

$tz = [TimeSpan]::FromHours(7)
$start = [DateTimeOffset]::new([datetime]'2026-10-01', $tz).ToString('o')
$end = [DateTimeOffset]::new(([datetime]'2026-11-26').AddDays(1).AddSeconds(-1), $tz).ToString('o')

function Get-OrdersPage($page) {
  $qb = [System.Web.HttpUtility]::ParseQueryString('')
  $qb['api_key'] = $ApiKey
  $qb['page_size'] = '50'
  $qb['page_number'] = "$page"
  $qb['start_date_time_iso'] = $start
  $qb['end_date_time_iso'] = $end
  $url = "https://pos.pages.fm/api/v1/shops/$ShopId/orders?$($qb.ToString())"
  return Invoke-RestMethod -Uri $url -TimeoutSec 90
}

$wanted = @('shipped','delivered','received_money','returned','waitting')
$found = @{}
$page = 1
while ($page -le 8 -and $found.Count -lt 8) {
  $r = Get-OrdersPage $page
  foreach ($o in @($r.data)) {
    $st = [string]$o.status_name
    if ($wanted -contains $st -and -not $found.ContainsKey($st)) {
      $found[$st] = $o
    }
  }
  if (-not $r.data -or @($r.data).Count -lt 50) { break }
  $page++
}

"found statuses: $($found.Keys -join ', ')"
foreach ($st in ($found.Keys | Sort-Object)) {
  $o = $found[$st]
  "`n==== $st order=$($o.system_id) ===="
  "inserted_at=$($o.inserted_at) updated_at=$($o.updated_at) time_send_partner=$($o.time_send_partner)"
  "status=$($o.status) status_name=$($o.status_name)"
  if ($o.status_history) {
    "status_history type=$($o.status_history.GetType().FullName)"
    $o.status_history | ConvertTo-Json -Depth 6 -Compress
  } else { "status_history=null" }
  if ($o.histories) {
    "histories count=$(@($o.histories).Count)"
    @($o.histories) | Select-Object -First 5 | ForEach-Object {
      $_ | ConvertTo-Json -Depth 4 -Compress
    }
  }
}

# status code map from sample
"`n=== status code histogram (pages 1-5) ==="
$hist = @{}
for ($p=1; $p -le 5; $p++) {
  $r = Get-OrdersPage $p
  foreach ($o in @($r.data)) {
    $k = "$($o.status)|$($o.status_name)"
    if (-not $hist.ContainsKey($k)) { $hist[$k] = 0 }
    $hist[$k]++
  }
}
$hist.GetEnumerator() | Sort-Object Name | ForEach-Object { "$($_.Key) = $($_.Value)" }
