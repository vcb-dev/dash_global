$ErrorActionPreference = 'Stop'
$cfg = @{}
Get-Content (Join-Path $PSScriptRoot '.env') | Where-Object { $_ -match '^\s*([^#=]+)=(.*)$' } | ForEach-Object {
    $cfg[$Matches[1].Trim()] = $Matches[2].Trim()
}
$ApiKey = $cfg['PANCAKE_API_KEY']
$ShopId = $cfg['PANCAKE_SHOP_ID']
$Base = "https://pos.pages.fm/api/v1/shops/$ShopId/analytics/sale"
$tz = [TimeSpan]::FromHours(7)
$since = [DateTimeOffset]::new([datetime]'2026-10-17', $tz).UtcDateTime.ToString('yyyy-MM-ddTHH:mm:ss')
$until = [DateTimeOffset]::new(([datetime]'2026-11-18').AddDays(1).AddSeconds(-1), $tz).UtcDateTime.ToString('yyyy-MM-ddTHH:mm:ss')
$th = 'd32f2d75-1cd8-4987-a960-ed69bfeae918'
$jp = '5d131d34-4d4e-49a4-beba-a59599eb3be1'

function Get-Sale([hashtable]$extra) {
    $qb = [System.Web.HttpUtility]::ParseQueryString('')
    $qb['api_key'] = $ApiKey
    $qb['since'] = $since
    $qb['until'] = $until
    $qb['success_record'] = 'inserted_at'
    $qb['success_status'] = '0'
    $qb['returned_record'] = 'success_record'
    $qb['user_type'] = 'update'
    $null = $qb.Add('select_fields[]', 'success_order_count')
    $null = $qb.Add('select_fields[]', 'revenue')
    foreach ($k in $extra.Keys) {
        if ($extra[$k] -is [array]) { foreach ($v in $extra[$k]) { $null = $qb.Add($k, $v) } }
        else { $qb[$k] = [string]$extra[$k] }
    }
    $url = "$Base`?$($qb.ToString())"
    return Invoke-RestMethod -Uri $url -TimeoutSec 180
}

Add-Type -AssemblyName System.Web

Write-Host "Period UTC $since -> $until"
$rTh = Get-Sale @{ 'warehouse_ids[]' = @($th) }
$rJp = Get-Sale @{ 'warehouse_ids[]' = @($jp) }
"TH warehouse_ids: don=$($rTh.data[0].result.success_order_count) rev=$([math]::Round([double]$rTh.data[0].result.revenue))"
"JP warehouse_ids: don=$($rJp.data[0].result.success_order_count) rev=$([math]::Round([double]$rJp.data[0].result.revenue))"
"POS expect TH 452 / 1071024003 | JP 395 / 1204125641"

$dayTh = Get-Sale @{ 'warehouse_ids[]' = @($th); 'split_by[]' = @('Time.day') }
$d30 = $dayTh.data | Where-Object { $_.'Time.day' -eq '2026-10-30' } | Select-Object -First 1
"TH 30/10 API: don=$($d30.result.success_order_count) rev=$([math]::Round([double]$d30.result.revenue)) | POS screenshot: 8 / 11904352"
