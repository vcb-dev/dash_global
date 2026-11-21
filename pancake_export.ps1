<#
.SYNOPSIS
  Lấy dữ liệu Pancake POS và xuất theo mô hình Star Schema cho Power BI:
    fact_doanh_thu  : Thống kê → Doanh thu (Ngày chốt, mọi trạng thái), grain ngày × kho × SKU
    fact_ton_kho    : Xuất nhập kho → Thống kê theo mẫu mã, tồn cuối kỳ theo SKU × kho
    dim_spu         : danh mục SPU chuẩn hóa (hợp của danh mục POS + 2 bảng fact)
    dim_date        : lịch ngày
    dim_kho         : danh sách kho

.EXAMPLE
  .\pancake_export.ps1                                   # từ ngày 1 tháng này đến hôm nay
  .\pancake_export.ps1 -StartDate 2026-11-01 -EndDate 2026-11-13
#>
param(
    [datetime]$StartDate = (Get-Date -Day 1).Date,
    [datetime]$EndDate = (Get-Date).Date,
    [string[]]$Warehouses = @('KHO THÁI LAN', 'KHO NHẬT BẢN'),
    [int]$NewCodeDays = 90,
    [switch]$SkipDb,
    [string]$OutDir = (Join-Path $PSScriptRoot 'output')
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$cfg = @{}
Get-Content (Join-Path $PSScriptRoot '.env') | Where-Object { $_ -match '^\s*([^#=]+)=(.*)$' } | ForEach-Object {
    $cfg[$Matches[1].Trim()] = $Matches[2].Trim()
}
$ApiKey = $cfg['PANCAKE_API_KEY']
$ShopId = $cfg['PANCAKE_SHOP_ID']
$Base = 'https://pos.pages.fm/api/v1'

# POS chia ngày theo giờ Việt Nam, còn since/until của API hiểu là UTC
$tz = [TimeSpan]::FromHours(7)
$startLocal = [DateTimeOffset]::new($StartDate.Date, $tz)
$endLocal = [DateTimeOffset]::new($EndDate.Date.AddDays(1).AddSeconds(-1), $tz)

function Invoke-Pos([string]$path, [string]$query) {
    $url = "$Base/shops/$ShopId/$path`?api_key=$ApiKey&$query"
    for ($i = 1; $i -le 3; $i++) {
        try { return Invoke-RestMethod -Uri $url -TimeoutSec 120 }
        catch {
            if ($i -eq 3) { throw }
            Start-Sleep -Seconds (5 * $i)
        }
    }
}

function Get-Size($variation) {
    ($variation.fields | Where-Object { $_.name -match 'size' } | Select-Object -First 1).value
}

# Mapping tay (spu_goc → spu_key) được ưu tiên trước quy tắc tự động
$mapFile = Join-Path $PSScriptRoot 'spu_mapping.csv'
$manualMap = @{}
if (Test-Path $mapFile) {
    Import-Csv $mapFile | Where-Object { $_.spu_goc } | ForEach-Object { $manualMap[$_.spu_goc.Trim().ToUpper()] = $_.spu_key.Trim().ToUpper() }
}

function Get-ChungLoai([string]$spuKey) {
    if ($spuKey -eq 'KHONG_XAC_DINH') { return 'Các sản phẩm khác' }
    switch ("$spuKey".Trim().ToUpper().Substring(0, [math]::Min(1, "$spuKey".Trim().Length))) {
        'N' { 'Nhẫn' }
        'B' { 'Bông tai' }
        'K' { 'Kiềng' }
        'L' { 'Lắc tay' }
        'D' { 'Dây chuyền' }
        'G' { 'Đá quý' }
        'M' { 'Mặt dây' }
        'C' { 'Charm' }
        'V' { 'Vòng' }
        'O' { 'Chốt bông tai' }
        default { 'Các sản phẩm khác' }
    }
}

# Mã trang sức có dạng 1–2 chữ cái + số (N0036, CT02); NRB001, MATRUNGGIANBAC, tên dịch vụ… là hàng khác
function Get-LoaiMa([string]$spuKey, [string]$posCategory) {
    if ($posCategory -eq 'HỘP' -or $spuKey -match '^(TL-)?H\d') { return 'Hộp/Phụ kiện' }
    if ($spuKey -match '^[A-Z]{1,2}\d' -and $posCategory -ne 'KHÁC') { return 'Sản phẩm' }
    return 'Khác/Dịch vụ'
}

function Get-SpuKey([string]$spu, [string]$sku) {
    $x = "$spu".Trim().TrimEnd(',').ToUpper()
    if (-not $x) { $x = "$sku".Trim().TrimEnd(',').ToUpper() }
    if (-not $x) { return $null }
    # Nhiều mã gốc dính nhau bằng | → lấy mã đầu
    if ($x.Contains('|')) { $x = ($x -split '\|')[0].Trim() }
    if ($manualMap.ContainsKey($x)) { return $manualMap[$x] }
    $x = $x -replace '^VN-', ''
    # Giữ tiền tố TL- (hộp/phụ kiện Thái), rồi cắt mọi hậu tố sau dấu -
    # Ví dụ: N9272-08-S-PK → N9272 | B9043-C004 → B9043 | CT02-HO → CT02 | TL-H013-1 → TL-H013
    $prefix = ''
    if ($x -match '^TL-\s*(.+)$') { $prefix = 'TL-'; $x = $Matches[1].Trim() }
    if ($x.Contains('-')) { $x = ($x -split '-', 2)[0].Trim() }
    $x = $prefix + $x
    if ($manualMap.ContainsKey($x)) { return $manualMap[$x] }
    return $x
}

New-Item -ItemType Directory -Force $OutDir | Out-Null
$tag = '{0:yyyyMMdd}_{1:yyyyMMdd}' -f $StartDate, $EndDate

$allWh = (Invoke-Pos 'warehouses' '').data
$wh = $allWh | Where-Object { $Warehouses -contains $_.name }
if (-not $wh) { throw "Không tìm thấy kho: $($Warehouses -join ', ')" }
$whName = @{}; $wh | ForEach-Object { $whName[$_.id] = $_.name }
Write-Host "Kho: $($wh.name -join ', ') | Kỳ: $($StartDate.ToString('dd/MM/yyyy')) - $($EndDate.ToString('dd/MM/yyyy'))"

$catName = @{}
(Invoke-Pos 'categories' '').data | ForEach-Object { $catName[[string]$_.id] = $_.text }
function Get-CatName($categoryIds) {
    $id = $categoryIds | Select-Object -First 1
    if ($null -eq $id) { return $null }
    return $catName["$id"]
}

# Thông tin SPU gom từ mọi nguồn: spu_key → thuộc tính
$spuInfo = @{}
function Add-SpuInfo([string]$key, [string]$spuGoc, [string]$name, [string]$category, $insertedAt, [string]$source) {
    if (-not $key) { return }
    if (-not $spuInfo.ContainsKey($key)) {
        $spuInfo[$key] = @{ goc = [System.Collections.Generic.HashSet[string]]::new(); name = $null; cat = $null; ins = $null; src = [System.Collections.Generic.HashSet[string]]::new() }
    }
    $e = $spuInfo[$key]
    if ($spuGoc) { [void]$e.goc.Add($spuGoc) }
    [void]$e.src.Add($source)
    if (-not $e.name -and $name) { $e.name = $name }
    if (-not $e.cat -and $category) { $e.cat = $category }
    if ($insertedAt) {
        $d = ([datetime]$insertedAt).Date
        if (-not $e.ins -or $d -lt $e.ins) { $e.ins = $d }
    }
}

# 1. Danh mục sản phẩm POS
$page = 1
do {
    $res = Invoke-Pos 'products/variations' "page_size=200&page_number=$page"
    foreach ($v in $res.data) {
        $spuGoc = $v.product.display_id
        $cat = ($v.product.categories | Select-Object -First 1).name
        Add-SpuInfo (Get-SpuKey $spuGoc $v.display_id) $spuGoc $v.product.name $cat $v.product.inserted_at 'DM'
    }
    $page++
} while ($page -le $res.total_pages)

# 2. fact_doanh_thu
# - Doanh thu / SL: tách theo SKU (đúng chi tiết mã)
# - Đơn chốt: lấy từ API ngày×kho (khớp POS), gán 1 lần / ngày×kho rồi các dòng SKU khác = 0
#   → SUM(don_chot) theo kho = đúng POS, vẫn giữ đủ số dòng mã
$fields = 'success_order_count', 'revenue', 'product_count' | ForEach-Object { "select_fields[]=$_" }
$qBase = @(
    'since=' + $startLocal.UtcDateTime.ToString('yyyy-MM-ddTHH:mm:ss')
    'until=' + $endLocal.UtcDateTime.ToString('yyyy-MM-ddTHH:mm:ss')
    'success_record=inserted_at', 'success_status=0', 'returned_record=success_record', 'user_type=update'
) + $fields

$saleKho = Invoke-Pos 'analytics/sale' (($qBase + @('split_by[]=Time.day', 'split_by[]=Order.warehouse_id')) -join '&')
$donTheoKho = @{}
foreach ($r in $saleKho.data) {
    if (-not $whName.ContainsKey($r.'Order.warehouse_id')) { continue }
    $k = "$($r.'Time.day')|$($whName[$r.'Order.warehouse_id'])"
    $donTheoKho[$k] = [int]$r.result.success_order_count
}

$sale = Invoke-Pos 'analytics/sale' (($qBase + @('split_by[]=Time.day', 'split_by[]=Order.warehouse_id', 'split_by[]=Variation.id')) -join '&')
$revenue = foreach ($r in $sale.data) {
    if (-not $whName.ContainsKey($r.'Order.warehouse_id')) { continue }
    $v = $r.variation
    $key = Get-SpuKey $v.product.custom_id $v.custom_id
    if (-not $key) {
        if (-not $r.result.revenue -and -not $r.result.product_count) { continue }
        $key = 'KHONG_XAC_DINH'
        Add-SpuInfo $key $null 'Không xác định (đơn không có sản phẩm)' $null $null 'DT'
    }
    Add-SpuInfo $key $v.product.custom_id $v.product.name (Get-CatName $v.product.category_ids) $null 'DT'
    [pscustomobject]@{
        ngay               = $r.'Time.day'
        kho                = $whName[$r.'Order.warehouse_id']
        sku                = if ($v.custom_id) { "$($v.custom_id)".Trim().TrimEnd(',') } else { $key }
        spu_key            = $key
        size               = Get-Size $v
        don_chot           = 0
        so_luong           = [double]$r.result.product_count
        order_revenue_vnd  = [double]$r.result.revenue
        revenue_truoc_hoan = [double]$r.success.revenue
        doanh_thu_hoan     = if ($r.returned) { [double]$r.returned.revenue } else { 0 }
    }
}
$revenue = @($revenue | Sort-Object ngay, kho, sku)
$seenDon = @{}
foreach ($row in $revenue) {
    $k = "$($row.ngay)|$($row.kho)"
    if (-not $seenDon.ContainsKey($k)) {
        $row.don_chot = if ($donTheoKho.ContainsKey($k)) { $donTheoKho[$k] } else { 0 }
        $seenDon[$k] = $true
    }
}
$revenue | Export-Csv (Join-Path $OutDir "fact_doanh_thu_$tag.csv") -NoTypeInformation -Encoding UTF8
Write-Host ("fact_doanh_thu: {0} dòng mã | đơn chốt {1:N0} | DT {2:N0}" -f `
    $revenue.Count, ($revenue | Measure-Object don_chot -Sum).Sum, ($revenue | Measure-Object order_revenue_vnd -Sum).Sum)

# 3. fact_ton_kho: tồn cuối ngày cho từng ngày trong kỳ
$inventory = [System.Collections.Generic.List[object]]::new()
$seenTk = @{}
for ($day = $StartDate.Date; $day -le $EndDate.Date; $day = $day.AddDays(1)) {
  $dayStart = [DateTimeOffset]::new($day, $tz).ToUnixTimeSeconds()
  $dayEnd = [DateTimeOffset]::new($day.AddDays(1).AddSeconds(-1), $tz).ToUnixTimeSeconds()
  foreach ($w in $wh) {
    $page = 1
    do {
        $iq = "start_date=$dayStart&end_date=$dayEnd&type=actual&warehouse_ids[]=$($w.id)&page=$page&page_size=2000"
        $res = Invoke-Pos 'inventory_analytics/inventory' $iq
        foreach ($d in $res.data) {
            if ($d.end_inventory -eq 0 -and $d.begin_inventory -eq 0 -and $d.total_import -eq 0 -and $d.total_export -eq 0) { continue }
            $v = $d.variation
            $key = Get-SpuKey $v.product.custom_id $v.custom_id
            if (-not $seenTk.ContainsKey($v.custom_id)) {
                $seenTk[$v.custom_id] = 1
                Add-SpuInfo $key $v.product.custom_id $v.product.name (Get-CatName $v.product.category_ids) $v.product.inserted_at 'TK'
            }
            $inventory.Add([pscustomobject]@{
                ngay            = $day.ToString('yyyy-MM-dd')
                kho             = $w.name
                sku             = "$($v.custom_id)".Trim().TrimEnd(',')
                spu_key         = $key
                size            = Get-Size $v
                begin_qty       = $d.begin_inventory
                import_qty      = $d.total_import
                sell_export_qty = -1 * $d.sell_export
                inventory_qty   = $d.end_inventory
                inventory_value = $d.end_inventory_value
            })
        }
        $page++
    } while ($page -le $res.total_pages)
  }
  Write-Host "  Tồn kho ngày $($day.ToString('dd/MM/yyyy'))"
}
$inventory | Sort-Object ngay, kho, sku | Export-Csv (Join-Path $OutDir "fact_ton_kho_$tag.csv") -NoTypeInformation -Encoding UTF8
$lastInv = $inventory | Where-Object { $_.ngay -eq $EndDate.ToString('yyyy-MM-dd') }
Write-Host ("fact_ton_kho: {0} dòng ({1} ngày) | tồn cuối {2}: {3:N0} sp, {4:N0} VNĐ" -f $inventory.Count, (($EndDate.Date - $StartDate.Date).Days + 1), $EndDate.ToString('dd/MM'), ($lastInv | Measure-Object inventory_qty -Sum).Sum, ($lastInv | Measure-Object inventory_value -Sum).Sum)

# 4. dim_spu – gộp với file cũ; cắt lại spu_key cũ rồi ghi:
#    spu_key = mã đã cắt (dùng join fact), spu_goc = mã gốc còn dấu - / |
$dimFile = Join-Path $OutDir 'dim_spu.csv'
$old = @{}
if (Test-Path $dimFile) {
    Import-Csv $dimFile | ForEach-Object {
        $nk = Get-SpuKey $_.spu_key ''
        if (-not $nk -and $_.spu_goc) { $nk = Get-SpuKey (($_.spu_goc -split '\|')[0]) '' }
        if (-not $nk) { return }
        $goc = @($_.spu_goc -split '\|') + @($_.spu_key)
        if ($old.ContainsKey($nk)) {
            $goc += $old[$nk].spu_goc -split '\|'
            if (-not $_.ten_san_pham -and $old[$nk].ten_san_pham) { $_.ten_san_pham = $old[$nk].ten_san_pham }
            if (-not $_.chung_loai_pos -and $old[$nk].chung_loai_pos) { $_.chung_loai_pos = $old[$nk].chung_loai_pos }
            if (-not $_.ngay_tao_ma -and $old[$nk].ngay_tao_ma) { $_.ngay_tao_ma = $old[$nk].ngay_tao_ma }
        }
        $_.spu_key = $nk
        $_.spu_goc = (($goc | Where-Object { $_ } | Sort-Object -Unique) -join '|')
        $old[$nk] = $_
    }
}

$dim = @{}
foreach ($k in $old.Keys) { $dim[$k] = $old[$k] }
foreach ($k in $spuInfo.Keys) {
    $e = $spuInfo[$k]
    $prev = $old[$k]
    $cat = if ($e.cat) { $e.cat } elseif ($prev) { $prev.chung_loai_pos } else { '' }
    $name = if ($e.name) { $e.name } elseif ($prev) { $prev.ten_san_pham } else { '' }
    $ins = if ($e.ins) { $e.ins } elseif ($prev -and $prev.ngay_tao_ma) { [datetime]$prev.ngay_tao_ma } else { $null }
    $loai = Get-LoaiMa $k $cat
    $goc = @($e.goc)
    if ($prev -and $prev.spu_goc) { $goc += $prev.spu_goc -split '\|' }
    $dim[$k] = [pscustomobject]@{
        spu_key      = $k
        ten_san_pham = $name
        chung_loai   = if ($loai -eq 'Sản phẩm') { Get-ChungLoai $k } else { 'Các sản phẩm khác' }
        chung_loai_pos = $cat
        loai_ma      = $loai
        ngay_tao_ma  = if ($ins) { $ins.ToString('yyyy-MM-dd') } else { '' }
        ma_cu_moi    = if ($ins -and $ins -ge $EndDate.AddDays(-$NewCodeDays)) { 'Mã mới' } else { 'Mã cũ' }
        trong_danh_muc = if ($e.src.Contains('DM')) { 'Có' } else { 'Không' }
        spu_goc      = (($goc | Where-Object { $_ } | Sort-Object -Unique) -join '|')
        # phan_khuc / sl_30_ngay / spunew do load_supabase.js ghi sau khi có fact
        phan_khuc    = ''
        sl_30_ngay   = ''
        ngay_chot_phan_khuc = ''
        spunew       = ''
    }
}
$dim.Values | Sort-Object spu_key | Export-Csv $dimFile -NoTypeInformation -Encoding UTF8

$revKeys = $revenue.spu_key | Sort-Object -Unique
$invKeys = $inventory.spu_key | Sort-Object -Unique
Write-Host ("dim_spu: {0} SPU | SPU doanh thu {1}, SPU tồn {2}, có cả hai {3}" -f $dim.Count, @($revKeys).Count, @($invKeys).Count, @($revKeys | Where-Object { $invKeys -contains $_ }).Count)

# 5. dim_date – đúng kỳ StartDate → EndDate (không kéo lịch thừa)
$dateFile = Join-Path $OutDir 'dim_date.csv'
$from = $StartDate.Date
$to = $EndDate.Date
$thu = @('CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7')
$cal = [System.Globalization.CultureInfo]::InvariantCulture.Calendar
$dates = for ($d = $from; $d -le $to; $d = $d.AddDays(1)) {
    $eom = $d.AddDays(1 - $d.Day).AddMonths(1).AddDays(-1)
    $dow = [int]$d.DayOfWeek
    [pscustomobject]@{
        ngay             = $d.ToString('yyyy-MM-dd')
        nam              = $d.Year
        quy              = 'Q' + [math]::Ceiling($d.Month / 3)
        thang            = $d.Month
        ky_bao_cao       = $d.ToString('yyyy-MM')
        ten_thang        = 'T' + $d.ToString('MM/yyyy')
        ngay_trong_thang = $d.Day
        so_ngay_thang    = $eom.Day
        cuoi_thang       = $eom.ToString('yyyy-MM-dd')
        la_cuoi_thang    = [int]($d -eq $eom)
        thu              = $thu[$dow]
        thu_so           = if ($dow -eq 0) { 7 } else { $dow }
        tuan_iso         = $cal.GetWeekOfYear($d, [System.Globalization.CalendarWeekRule]::FirstFourDayWeek, [DayOfWeek]::Monday)
        # Báo cáo gửi thứ Sáu, chốt dữ liệu hết thứ Năm: ngày chốt của tuần chứa ngày này
        ngay_chot_tuan   = $d.AddDays((4 - $dow + 7) % 7).ToString('yyyy-MM-dd')
    }
}
$dates | Export-Csv $dateFile -NoTypeInformation -Encoding UTF8

# 6. dim_kho – chỉ các kho đang lọc (mặc định Nhật + Thái); không chọn kho trên PBI = tổng 2 kho
$wh | ForEach-Object { [pscustomobject]@{ kho = $_.name; kho_id = $_.id; ma_quoc_gia = $_.country_code } } |
    Export-Csv (Join-Path $OutDir 'dim_kho.csv') -NoTypeInformation -Encoding UTF8

Write-Host "Xong. File trong: $OutDir"

$node = Join-Path $PSScriptRoot 'tools\node\node.exe'
if (-not $SkipDb -and $cfg['SUPABASE_DB_URL'] -and (Test-Path $node)) {
    Write-Host 'Nạp lên Supabase...'
    & $node (Join-Path $PSScriptRoot 'load_supabase.js') $OutDir
    if ($LASTEXITCODE -ne 0) { throw 'Nạp Supabase thất bại' }
}

