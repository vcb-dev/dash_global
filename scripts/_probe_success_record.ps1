$ErrorActionPreference = 'Stop'
$cfg = @{}
Get-Content 'D:\Cursor\Global\pancake\.env' | Where-Object { $_ -match '^\s*([^#=]+)=(.*)$' } | ForEach-Object {
  $cfg[$Matches[1].Trim()] = $Matches[2].Trim()
}
$ApiKey = $cfg['PANCAKE_API_KEY']
$ShopId = $cfg['PANCAKE_SHOP_ID']
$Base = "https://pos.pages.fm/api/v1/shops/$ShopId/analytics/sale"
Add-Type -AssemblyName System.Web

$tz = [TimeSpan]::FromHours(7)
$since = [DateTimeOffset]::new([datetime]'2026-11-01', $tz).UtcDateTime.ToString('yyyy-MM-ddTHH:mm:ss')
$until = [DateTimeOffset]::new(([datetime]'2026-11-15').AddDays(1).AddSeconds(-1), $tz).UtcDateTime.ToString('yyyy-MM-ddTHH:mm:ss')

$candidates = @(
  'inserted_at',
  'updated_at',
  'last_update_status_at',
  'shipped_at',
  'exported_at',
  'delivered_at',
  'success_at',
  'received_at',
  'estimate_delivery_date',
  'status_history',
  'last_exported_at',
  'export_at',
  'success_record',
  'completed_at',
  'confirmed_at'
)

function Probe([string]$sr) {
  $qb = [System.Web.HttpUtility]::ParseQueryString('')
  $qb['api_key'] = $ApiKey
  $qb['since'] = $since
  $qb['until'] = $until
  $qb['success_record'] = $sr
  $qb['success_status'] = '0'
  $qb['returned_record'] = 'success_record'
  $qb['user_type'] = 'update'
  $null = $qb.Add('select_fields[]', 'success_order_count')
  $null = $qb.Add('select_fields[]', 'revenue')
  $null = $qb.Add('split_by[]', 'Time.day')
  $url = "$Base`?$($qb.ToString())"
  try {
    $r = Invoke-RestMethod -Uri $url -TimeoutSec 60
    $don = 0; $rev = 0.0; $days = 0
    if ($r.data) {
      $days = @($r.data).Count
      foreach ($row in @($r.data)) {
        $don += [int]($row.result.success_order_count)
        $rev += [double]($row.result.revenue)
      }
    }
    return [pscustomobject]@{ success_record = $sr; ok = $true; days = $days; don = $don; rev = [math]::Round($rev); err = '' }
  } catch {
    $msg = $_.Exception.Message
    if ($_.ErrorDetails.Message) { $msg = $_.ErrorDetails.Message }
    return [pscustomobject]@{ success_record = $sr; ok = $false; days = 0; don = 0; rev = 0; err = ($msg -replace '\s+',' ').Substring(0, [Math]::Min(120, $msg.Length)) }
  }
}

$results = foreach ($c in $candidates) { Probe $c }
$results | Format-Table -AutoSize
$results | ConvertTo-Json -Compress | Set-Content (Join-Path $PSScriptRoot '_probe_success_record.json')
