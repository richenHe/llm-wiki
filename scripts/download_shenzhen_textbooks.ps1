$ErrorActionPreference = 'Stop'

$root = 'D:\video'
$jobId = 'shenzhen-junior-textbooks-20260803'
$stageRoot = Join-Path $root ("package\.staging\" + $jobId)
$manifestPath = Join-Path $root '教材下载清单.csv'
$logPath = Join-Path $root '教材下载进度.log'
$ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138 Safari/537.36'

$items = @(
    # 道德与法治（统编/人教）
    @{ Subject='道德与法治'; File='道德与法治_七年级上册_统编版_2024秋.pdf'; Id='14941264'; Page='https://jsjy.mtc.edu.cn/info/1041/1365.htm'; Source='绵阳师范学院教师教育学院' },
    @{ Subject='道德与法治'; File='道德与法治_七年级下册_统编版_2025春.pdf'; Id='14941263'; Page='https://jsjy.mtc.edu.cn/info/1041/1365.htm'; Source='绵阳师范学院教师教育学院' },
    @{ Subject='道德与法治'; File='道德与法治_八年级上册_统编版.pdf'; Id='14941261'; Page='https://jsjy.mtc.edu.cn/info/1041/1365.htm'; Source='绵阳师范学院教师教育学院' },
    @{ Subject='道德与法治'; File='道德与法治_八年级下册_统编版.pdf'; Id='14941259'; Page='https://jsjy.mtc.edu.cn/info/1041/1365.htm'; Source='绵阳师范学院教师教育学院' },
    @{ Subject='道德与法治'; File='道德与法治_九年级上册_统编版.pdf'; Id='14941260'; Page='https://jsjy.mtc.edu.cn/info/1041/1365.htm'; Source='绵阳师范学院教师教育学院' },
    @{ Subject='道德与法治'; File='道德与法治_九年级下册_统编版.pdf'; Id='14941262'; Page='https://jsjy.mtc.edu.cn/info/1041/1365.htm'; Source='绵阳师范学院教师教育学院' },

    # 语文（统编/人教）
    @{ Subject='语文'; File='语文_七年级上册_统编版_2024秋.pdf'; Id='14941114'; Page='https://jsjy.mtc.edu.cn/info/1038/1353.htm'; Source='绵阳师范学院教师教育学院' },
    @{ Subject='语文'; File='语文_七年级下册_统编版_2025春.pdf'; Id='14941115'; Page='https://jsjy.mtc.edu.cn/info/1038/1353.htm'; Source='绵阳师范学院教师教育学院' },
    @{ Subject='语文'; File='语文_八年级上册_统编版_2025秋.pdf'; Id='14941117'; Page='https://jsjy.mtc.edu.cn/info/1038/1353.htm'; Source='绵阳师范学院教师教育学院' },
    @{ Subject='语文'; File='语文_八年级下册_统编版.pdf'; Id='14941111'; Page='https://jsjy.mtc.edu.cn/info/1038/1353.htm'; Source='绵阳师范学院教师教育学院' },
    @{ Subject='语文'; File='语文_九年级上册_统编版.pdf'; Id='14941112'; Page='https://jsjy.mtc.edu.cn/info/1038/1353.htm'; Source='绵阳师范学院教师教育学院' },
    @{ Subject='语文'; File='语文_九年级下册_统编版.pdf'; Id='14941113'; Page='https://jsjy.mtc.edu.cn/info/1038/1353.htm'; Source='绵阳师范学院教师教育学院' },

    # 物理（人教版）
    @{ Subject='物理'; File='物理_八年级上册_人教版_2024秋.pdf'; Id='14941274'; Page='https://jsjy.mtc.edu.cn/info/1077/1367.htm'; Source='绵阳师范学院教师教育学院' },
    @{ Subject='物理'; File='物理_八年级下册_人教版_2025春.pdf'; Id='14941273'; Page='https://jsjy.mtc.edu.cn/info/1077/1367.htm'; Source='绵阳师范学院教师教育学院' },
    @{ Subject='物理'; File='物理_九年级全一册_人教版_2025秋.pdf'; Id='14941275'; Page='https://jsjy.mtc.edu.cn/info/1077/1367.htm'; Source='绵阳师范学院教师教育学院' },

    # 化学（人教版）
    @{ Subject='化学'; File='化学_九年级上册_人教版_2024秋.pdf'; Id='14941283'; Page='https://jsjy.mtc.edu.cn/info/1072/1369.htm'; Source='绵阳师范学院教师教育学院' },
    @{ Subject='化学'; File='化学_九年级下册_人教版_2025春.pdf'; Id='14941284'; Page='https://jsjy.mtc.edu.cn/info/1072/1369.htm'; Source='绵阳师范学院教师教育学院' },

    # 生物（人教版）
    @{ Subject='生物'; File='生物_七年级上册_人教版_2024秋.pdf'; Id='14941448'; Page='https://jsjy.mtc.edu.cn/info/1075/1379.htm'; Source='绵阳师范学院教师教育学院' },
    @{ Subject='生物'; File='生物_七年级下册_人教版_2025春.pdf'; Id='14941449'; Page='https://jsjy.mtc.edu.cn/info/1075/1379.htm'; Source='绵阳师范学院教师教育学院' },
    @{ Subject='生物'; File='生物_八年级上册_人教版_2025秋.pdf'; Id='14941450'; Page='https://jsjy.mtc.edu.cn/info/1075/1379.htm'; Source='绵阳师范学院教师教育学院' },
    @{ Subject='生物'; File='生物_八年级下册_人教版.pdf'; Id='14941447'; Page='https://jsjy.mtc.edu.cn/info/1075/1379.htm'; Source='绵阳师范学院教师教育学院' },

    # 历史（统编/人教）
    @{ Subject='历史'; File='历史_七年级上册_统编版_2024秋.pdf'; Id='14941436'; Page='https://jsjy.mtc.edu.cn/info/1073/1377.htm'; Source='绵阳师范学院教师教育学院' },
    @{ Subject='历史'; File='历史_七年级下册_统编版_2025春.pdf'; Id='14941435'; Page='https://jsjy.mtc.edu.cn/info/1073/1377.htm'; Source='绵阳师范学院教师教育学院' },
    @{ Subject='历史'; File='历史_八年级上册_统编版_2025秋.pdf'; Id='14941437'; Page='https://jsjy.mtc.edu.cn/info/1073/1377.htm'; Source='绵阳师范学院教师教育学院' },
    @{ Subject='历史'; File='历史_八年级下册_统编版.pdf'; Id='14941432'; Page='https://jsjy.mtc.edu.cn/info/1073/1377.htm'; Source='绵阳师范学院教师教育学院' },
    @{ Subject='历史'; File='历史_九年级上册_统编版.pdf'; Id='14941433'; Page='https://jsjy.mtc.edu.cn/info/1073/1377.htm'; Source='绵阳师范学院教师教育学院' },
    @{ Subject='历史'; File='历史_九年级下册_统编版.pdf'; Id='14941434'; Page='https://jsjy.mtc.edu.cn/info/1073/1377.htm'; Source='绵阳师范学院教师教育学院' },

    # 音乐（人民音乐出版社，简谱）
    @{ Subject='音乐'; File='音乐_七年级上册_人音版简谱_2024秋.pdf'; Id='14941330'; Page='https://jsjy.mtc.edu.cn/info/1078/1375.htm'; Source='绵阳师范学院教师教育学院' },
    @{ Subject='音乐'; File='音乐_八年级上册_人音版简谱.pdf'; Id='14941328'; Page='https://jsjy.mtc.edu.cn/info/1078/1375.htm'; Source='绵阳师范学院教师教育学院' },
    @{ Subject='音乐'; File='音乐_八年级下册_人音版简谱.pdf'; Id='14941327'; Page='https://jsjy.mtc.edu.cn/info/1078/1375.htm'; Source='绵阳师范学院教师教育学院' },
    @{ Subject='音乐'; File='音乐_九年级上册_人音版简谱.pdf'; Id='14941329'; Page='https://jsjy.mtc.edu.cn/info/1078/1375.htm'; Source='绵阳师范学院教师教育学院' },
    @{ Subject='音乐'; File='音乐_九年级下册_人音版简谱.pdf'; Id='14941331'; Page='https://jsjy.mtc.edu.cn/info/1078/1375.htm'; Source='绵阳师范学院教师教育学院' },

    # 体育与健康（华东师大版）
    @{ Subject='体育与健康'; File='体育与健康_七年级全一册_华东师大版.pdf'; Url='http://ss.ecnupress.com.cn/smsc/jjfs/06/%E5%8D%8E%E4%B8%9C%E5%B8%88%E5%A4%A7%E7%89%88%E4%BD%93%E8%82%B2%E4%B8%8E%E5%81%A5%E5%BA%B7%E4%B8%83%E5%B9%B4%E7%BA%A7%E5%85%A8%E4%B8%80%E5%86%8C.pdf'; Page='http://s.ecnupress.com.cn/jjfs/06/list.aspx'; Source='华东师范大学出版社' },
    @{ Subject='体育与健康'; File='体育与健康_八年级全一册_华东师大版.pdf'; Url='http://ss.ecnupress.com.cn/smsc/jjfs/06/%E5%8D%8E%E4%B8%9C%E5%B8%88%E5%A4%A7%E7%89%88%E4%BD%93%E8%82%B2%E4%B8%8E%E5%81%A5%E5%BA%B7%E5%85%AB%E5%B9%B4%E7%BA%A7%E5%85%A8%E4%B8%80%E5%86%8C.pdf'; Page='http://s.ecnupress.com.cn/jjfs/06/list.aspx'; Source='华东师范大学出版社' },
    @{ Subject='体育与健康'; File='体育与健康_九年级全一册_华东师大版.pdf'; Url='http://ss.ecnupress.com.cn/smsc/jjfs/06/%E5%8D%8E%E4%B8%9C%E5%B8%88%E5%A4%A7%E7%89%88%E4%BD%93%E8%82%B2%E4%B8%8E%E5%81%A5%E5%BA%B7%E4%B9%9D%E5%B9%B4%E7%BA%A7%E5%85%A8%E4%B8%80%E5%86%8C.pdf'; Page='http://s.ecnupress.com.cn/jjfs/06/list.aspx'; Source='华东师范大学出版社' }
)

New-Item -ItemType Directory -Force -Path $root, $stageRoot | Out-Null
$records = New-Object System.Collections.Generic.List[object]

foreach ($item in $items) {
    $subjectDir = Join-Path $root $item.Subject
    $stageDir = Join-Path $stageRoot $item.Subject
    New-Item -ItemType Directory -Force -Path $subjectDir, $stageDir | Out-Null
    $finalPath = Join-Path $subjectDir $item.File
    $tempPath = Join-Path $stageDir ($item.File + '.part')
    $url = $item.Url
    if (-not $url) {
        $url = 'https://jsjy.mtc.edu.cn/system/_content/download.jsp?urltype=news.DownloadAttachUrl&owner=1803678113&wbfileid=' + $item.Id
    }

    if (Test-Path -LiteralPath $finalPath) {
        $existing = Get-Item -LiteralPath $finalPath
        $prefix = [System.IO.File]::ReadAllBytes($finalPath)[0..4]
        $magic = [Text.Encoding]::ASCII.GetString($prefix)
        if ($existing.Length -gt 50000 -and $magic -eq '%PDF-') {
            $hash = (Get-FileHash -LiteralPath $finalPath -Algorithm SHA256).Hash
            $records.Add([pscustomobject]@{ Status='EXISTS'; Subject=$item.Subject; File=$item.File; Bytes=$existing.Length; SHA256=$hash; Source=$item.Source; SourcePage=$item.Page; DownloadUrl=$url })
            Write-Output ("EXISTS " + $item.Subject + ' ' + $item.File)
            continue
        }
    }

    if (Test-Path -LiteralPath $tempPath) { Remove-Item -LiteralPath $tempPath -Force }
    Write-Output ("DOWNLOADING " + $item.Subject + ' ' + $item.File)
    & curl.exe -L --fail --retry 3 --retry-delay 2 --connect-timeout 20 --max-time 600 -A $ua -e $item.Page -o $tempPath $url
    if ($LASTEXITCODE -ne 0) { throw "curl failed: $($item.File), exit=$LASTEXITCODE" }
    $downloaded = Get-Item -LiteralPath $tempPath
    if ($downloaded.Length -le 50000) { throw "file too small: $($item.File), bytes=$($downloaded.Length)" }
    $bytes = [System.IO.File]::ReadAllBytes($tempPath)
    $magic = [Text.Encoding]::ASCII.GetString($bytes[0..4])
    if ($magic -ne '%PDF-') { throw "not a PDF: $($item.File), magic=$magic" }
    Move-Item -LiteralPath $tempPath -Destination $finalPath -Force
    $hash = (Get-FileHash -LiteralPath $finalPath -Algorithm SHA256).Hash
    $records.Add([pscustomobject]@{ Status='DOWNLOADED'; Subject=$item.Subject; File=$item.File; Bytes=$downloaded.Length; SHA256=$hash; Source=$item.Source; SourcePage=$item.Page; DownloadUrl=$url })
    Add-Content -LiteralPath $logPath -Encoding UTF8 -Value ("$(Get-Date -Format s) OK $($item.Subject) $($item.File) $($downloaded.Length) $hash")
}

$records | Export-Csv -LiteralPath $manifestPath -NoTypeInformation -Encoding UTF8
Write-Output ("COMPLETE count=" + $records.Count + " manifest=" + $manifestPath)
