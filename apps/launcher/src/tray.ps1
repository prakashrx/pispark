# PiSpark's Windows tray icon. Started hidden by the launcher, which writes "state <json>" lines on
# standard input; menu choices go back as one word per line on standard output.
param([string]$Icon)
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = if ($Icon -and (Test-Path $Icon)) { New-Object System.Drawing.Icon $Icon } else { [System.Drawing.SystemIcons]::Application }
$tray.Text = "PiSpark"
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$status = $menu.Items.Add("PiSpark")
$status.Enabled = $false
$open = $menu.Items.Add("Open PiSpark")
$open.Font = New-Object System.Drawing.Font($open.Font, [System.Drawing.FontStyle]::Bold)
$update = $menu.Items.Add("Update")
$update.Visible = $false
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$restart = $menu.Items.Add("Restart")
$logs = $menu.Items.Add("Open logs")
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$quit = $menu.Items.Add("Quit PiSpark")
$tray.ContextMenuStrip = $menu

function Send([string]$word) { [Console]::Out.WriteLine($word); [Console]::Out.Flush() }
$open.Add_Click({ Send "open" })
$update.Add_Click({ Send "update" })
$restart.Add_Click({ Send "restart" })
$logs.Add_Click({ Send "logs" })
$quit.Add_Click({ Send "quit" })
$tray.Add_MouseClick({ param($s, $e) if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) { Send "open" } })
$tray.Visible = $true

# Standard input is read on the thread pool; a timer applies what arrived on the UI thread.
$reader = New-Object System.IO.StreamReader([Console]::OpenStandardInput())
$script:pending = $reader.ReadLineAsync()
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 200
$timer.Add_Tick({
  while ($script:pending.IsCompleted) {
    $line = $script:pending.Result
    if ($null -eq $line) { $tray.Visible = $false; [System.Windows.Forms.Application]::Exit(); return }
    if ($line.StartsWith("state ")) {
      $s = $line.Substring(6) | ConvertFrom-Json
      $status.Text = $s.line
      $tray.Text = if ($s.line.Length -gt 63) { $s.line.Substring(0, 63) } else { $s.line }
      $update.Visible = [bool]$s.update
      if ($s.update) { $update.Text = $s.update }
    }
    $script:pending = $reader.ReadLineAsync()
  }
})
$timer.Start()
[System.Windows.Forms.Application]::Run()
$tray.Visible = $false
