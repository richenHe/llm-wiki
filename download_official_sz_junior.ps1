$ErrorActionPreference = 'Continue'
$root = 'D:\video'
$referer = 'https://basic.smartedu.cn/'
$ua = 'Mozilla/5.0'
$items = @(
  [pscustomobject]@{S='道德与法治';V='七年级上册';U='https://r3-ndr-private.ykt.cbern.com.cn/edu_product/esp/assets/11446212-4b7b-4094-afe3-bd5b4f2b3f0c.pkg/%E4%B9%89%E5%8A%A1%E6%95%99%E8%82%B2%E6%95%99%E7%A7%91%E4%B9%A6%20%E9%81%93%E5%BE%B7%E4%B8%8E%E6%B3%95%E6%B2%BB%20%E4%B8%83%E5%B9%B4%E7%BA%A7%20%E4%B8%8A%E5%86%8C_1756191814528.pdf'},
  [pscustomobject]@{S='道德与法治';V='七年级下册';U='https://r1-ndr-private.ykt.cbern.com.cn/edu_product/esp/assets/4e1a2a9e-1e62-451f-a52e-ef99cb4e8bf2.pkg/pdf_1772437481251.pdf'},
  [pscustomobject]@{S='道德与法治';V='八年级上册';U='https://r2-ndr-private.ykt.cbern.com.cn/edu_product/esp/assets/5a29b928-d6da-4131-a69e-4c54941f7651.pkg/%E4%B9%89%E5%8A%A1%E6%95%99%E8%82%B2%E6%95%99%E7%A7%91%E4%B9%A6%20%E9%81%93%E5%BE%B7%E4%B8%8E%E6%B3%95%E6%B2%BB%20%E5%85%AB%E5%B9%B4%E7%BA%A7%20%E4%B8%8A%E5%86%8C_1756191816085.pdf'},
  [pscustomobject]@{S='道德与法治';V='八年级下册';U='https://r3-ndr-private.ykt.cbern.com.cn/edu_product/esp/assets/f1db2a19-2513-4626-8e6c-275cf549bdf2.pkg/pdf_1772437482793.pdf'},
  [pscustomobject]@{S='道德与法治';V='九年级上册';U='https://r1-ndr-private.ykt.cbern.com.cn/edu_product/esp/assets/03d41525-a373-4286-92c3-3f2d7cbe3b79.pkg/%E4%B9%89%E5%8A%A1%E6%95%99%E8%82%B2%E6%95%99%E7%A7%91%E4%B9%A6%20%E9%81%93%E5%BE%B7%E4%B8%8E%E6%B3%95%E6%B2%BB%20%E4%B9%9D%E5%B9%B4%E7%BA%A7%20%E4%B8%8A%E5%86%8C_1756191815328.pdf'},
  [pscustomobject]@{S='道德与法治';V='九年级下册';U='https://r3-ndr-private.ykt.cbern.com.cn/edu_product/esp/assets/845ceea7-36c6-4db8-b032-998193173585.pkg/pdf_1772437481985.pdf'},
  [pscustomobject]@{S='语文';V='七年级上册';U='https://r1-ndr-private.ykt.cbern.com.cn/edu_product/esp/assets/8b9c7052-add4-4744-ab04-69d6c180d5d9.pkg/%E4%B9%89%E5%8A%A1%E6%95%99%E8%82%B2%E6%95%99%E7%A7%91%E4%B9%A6%20%E8%AF%AD%E6%96%87%20%E4%B8%83%E5%B9%B4%E7%BA%A7%20%E4%B8%8A%E5%86%8C_1756191811964.pdf'},
  [pscustomobject]@{S='语文';V='七年级下册';U='https://r3-ndr-private.ykt.cbern.com.cn/edu_product/esp/assets/6b3ec445-9f7b-430c-a246-fc1903ca38b2.pkg/pdf_1772437479159.pdf'},
  [pscustomobject]@{S='语文';V='八年级上册';U='https://r1-ndr-private.ykt.cbern.com.cn/edu_product/esp/assets/4f64356a-8df7-4579-9400-e32c9a7f6718.pkg/%E4%B9%89%E5%8A%A1%E6%95%99%E8%82%B2%E6%95%99%E7%A7%91%E4%B9%A6%20%E8%AF%AD%E6%96%87%20%E5%85%AB%E5%B9%B4%E7%BA%A7%20%E4%B8%8A%E5%86%8C_1756191813436.pdf'},
  [pscustomobject]@{S='语文';V='八年级下册';U='https://r3-ndr-private.ykt.cbern.com.cn/edu_product/esp/assets/8f907d12-14b5-44ba-b042-0ffbc46e085b.pkg/pdf_1772437480567.pdf'},
  [pscustomobject]@{S='语文';V='九年级上册';U='https://r1-ndr-private.ykt.cbern.com.cn/edu_product/esp/assets/a8b13ab7-7eef-4dc7-a3c7-8009ba65ce11.pkg/%E4%B9%89%E5%8A%A1%E6%95%99%E8%82%B2%E6%95%99%E7%A7%91%E4%B9%A6%20%E8%AF%AD%E6%96%87%20%E4%B9%9D%E5%B9%B4%E7%BA%A7%20%E4%B8%8A%E5%86%8C_1756191812692.pdf'},
  [pscustomobject]@{S='语文';V='九年级下册';U='https://r3-ndr-private.ykt.cbern.com.cn/edu_product/esp/assets/a45516ee-78ed-46f0-b88b-671174f2a2fe.pkg/pdf_1772437479916.pdf'}
)
New-Item -ItemType Directory -Force -Path $root | Out-Null
$log = Join-Path $root '下载进度.log'
foreach ($i in $items) {
  $dir = Join-Path $root $i.S; New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $out = Join-Path $dir ($i.V + '.pdf'); $part = $out + '.part'
  if (Test-Path -LiteralPath $out) { "SKIP|$($i.S)|$($i.V)" | Add-Content -LiteralPath $log -Encoding utf8; continue }
  & curl.exe -fL --retry 3 --retry-delay 3 --referer $referer -A $ua -o $part $i.U
  if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $part) -and (Get-Item -LiteralPath $part).Length -gt 1024) {
    $sig=[System.IO.File]::ReadAllBytes($part)[0..3]; if(([Text.Encoding]::ASCII.GetString($sig)) -eq '%PDF') { Move-Item -LiteralPath $part -Destination $out; "OK|$($i.S)|$($i.V)" | Add-Content -LiteralPath $log -Encoding utf8; continue }
  }
  "FAIL|$($i.S)|$($i.V)" | Add-Content -LiteralPath $log -Encoding utf8
}
