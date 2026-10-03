param([string]$Source = 'readme.html')

$ErrorActionPreference = 'Stop'

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$src = [string](Resolve-Path (Join-Path $dir $Source) -ErrorAction SilentlyContinue)
if (-not $src) {
    Write-Host "$Source not found."
    exit 1
}
$base = [System.IO.Path]::ChangeExtension($src, $null).TrimEnd('.')
$docx = "$base.docx"
$pdf = "$base.pdf"

try {
    $word = New-Object -ComObject Word.Application
} catch {
    Write-Host 'Microsoft Word is not available - cannot create the docx / pdf readme.'
    exit 2
}

$word.Visible = $false
$word.DisplayAlerts = 0
$doc = $null
try {
    $doc = $word.Documents.Open($src, $false, $true)
    # 3 = wdPrintView, otherwise the docx opens in web layout
    $doc.ActiveWindow.View.Type = 3
    $doc.PageSetup.TopMargin = 54
    $doc.PageSetup.BottomMargin = 54
    $doc.PageSetup.LeftMargin = 54
    $doc.PageSetup.RightMargin = 54
    # 16 = wdFormatDocumentDefault (docx), 17 = wdExportFormatPDF
    $doc.SaveAs2($docx, 16)
    $doc.ExportAsFixedFormat($pdf, 17)
    Write-Host "Created $([System.IO.Path]::GetFileName($docx)) and $([System.IO.Path]::GetFileName($pdf))"
} catch {
    Write-Host "README conversion failed: $($_.Exception.Message)"
    exit 3
} finally {
    if ($doc) { $doc.Close(0) }
    $word.Quit()
}
