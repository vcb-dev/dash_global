$ErrorActionPreference = 'Stop'
$cfg = @{}
Get-Content 'D:\Cursor\Global\pancake\.env' | Where-Object { $_ -match '^\s*([^#=]+)=(.*)$' } | ForEach-Object {
  $cfg[$Matches[1].Trim()] = $Matches[2].Trim()
}
$ApiKey = $cfg['PANCAKE_API_KEY']
$ShopId = $cfg['PANCAKE_SHOP_ID']
Add-Type -AssemblyName System.Web

$tz = [TimeSpan]::FromHours(7)
$start = [DateTimeOffset]::new([datetime]'2026-11-20', $tz).ToString('o')
$end = [DateTimeOffset]::new(([datetime]'2026-11-26').AddDays(1).AddSeconds(-1), $tz).ToString('o')

$qb = [System.Web.HttpUtility]::ParseQueryString('')
$qb['api_key'] = $ApiKey
$qb['page_size'] = '20'
$qb['page_number'] = '1'
$qb['start_date_time_iso'] = $start
$qb['end_date_time_iso'] = $end
$url = "https://pos.pages.fm/api/v1/shops/$ShopId/orders?$($qb.ToString())"
$r = Invoke-RestMethod -Uri $url -TimeoutSec 60
$orders = @($r.data)
"orders=$($orders.Count)"

# Collect keys across sample + status-specific samples
$keys = New-Object System.Collections.Generic.HashSet[string]
$byStatus = @{}
foreach ($o in $orders) {
  foreach ($p in $o.PSObject.Properties) { [void]$keys.Add($p.Name) }
  $st = [string]$o.status_name
  if (-not $byStatus.ContainsKey($st)) { $byStatus[$st] = $o }
}

"=== top-level order keys ==="
$keys | Sort-Object

"=== sample per status (date-like fields) ==="
foreach ($st in ($byStatus.Keys | Sort-Object)) {
  $o = $byStatus[$st]
  $dates = @{}
  foreach ($p in $o.PSObject.Properties) {
    $n = $p.Name
    if ($n -match 'at$|date|time|ship|deliver|export|success|status|hist' -or $n -match 'inserted|updated|created') {
      $dates[$n] = $p.Value
    }
  }
  "--- status=$st id=$($o.id) ---"
  $dates.GetEnumerator() | Sort-Object Name | ForEach-Object { "  $($_.Key)=$($_.Value)" }
}

# Also probe analytics with success_status variants
$Base = "https://pos.pages.fm/api/v1/shops/$ShopId/analytics/sale"
$since = [DateTimeOffset]::new([datetime]'2026-11-01', $tz).UtcDateTime.ToString('yyyy-MM-ddTHH:mm:ss')
$until = [DateTimeOffset]::new(([datetime]'2026-11-15').AddDays(1).AddSeconds(-1), $tz).UtcDateTime.ToString('yyyy-MM-ddTHH:mm:ss')

function ProbeSale($extra) {
  $q = [System.Web.HttpUtility]::ParseQueryString('')
  $q['api_key'] = $ApiKey
  $q['since'] = $since
  $q['until'] = $until
  foreach ($k in $extra.Keys) {
    if ($extra[$k] -is [array]) { foreach ($v in $extra[$k]) { $null = $q.Add($k, [string]$v) } }
    else { $q[$k] = [string]$extra[$k] }
  }
  $null = $q.Add('select_fields[]', 'success_order_count')
  $null = $q.Add('select_fields[]', 'revenue')
  try {
    $res = Invoke-RestMethod -Uri "$Base`?$($q.ToString())" -TimeoutSec 60
    $don = 0; $rev = 0.0
    foreach ($row in @($res.data)) { $don += [int]$row.result.success_order_count; $rev += [double]$row.result.revenue }
    return "ok don=$don rev=$([math]::Round($rev))"
  } catch {
    return "ERR $($_.Exception.Message)"
  }
}

"`n=== analytics variants ==="
@(
  @{ success_record='inserted_at'; success_status='0'; returned_record='success_record'; user_type='update' },
  @{ success_record='inserted_at'; success_status='1'; returned_record='success_record'; user_type='update' },
  @{ success_record='inserted_at'; success_status='2'; returned_record='success_record'; user_type='update' },
  @{ success_record='inserted_at'; success_status='3'; returned_record='success_record'; user_type='update' },
  @{ success_record='updated_at'; success_status='0'; returned_record='success_record'; user_type='update' },
  @{ success_record='inserted_at'; success_status='0'; returned_record='success_record'; user_type='create' }
) | ForEach-Object {
  $label = ($_ | ConvertTo-Json -Compress)
  "$label => $(ProbeSale $_)"
}
