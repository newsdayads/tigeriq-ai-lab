using System.Diagnostics;
using System.Net.Http;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace TigerIQPhoneFarm;

internal static class Program {
  [STAThread]
  private static void Main() {
    ApplicationConfiguration.Initialize();
    Application.Run(new FarmWindow());
  }
}

internal sealed class FarmWindow : Form {
  private readonly WebView2 viewer = new() { Dock = DockStyle.Fill };
  private readonly Label loading = new() {
    Dock = DockStyle.Fill,
    Text = "TigerIQ Phone Farm\nĐang khởi động bộ điều khiển nội bộ...",
    TextAlign = ContentAlignment.MiddleCenter,
    Font = new Font("Segoe UI", 14f, FontStyle.Regular),
    ForeColor = Color.FromArgb(32, 107, 187),
    BackColor = Color.FromArgb(238, 246, 253)
  };
  private Process? ownedHost;
  private const string Origin = "http://127.0.0.1:8765";
  private readonly string appDirectory = AppContext.BaseDirectory;

  public FarmWindow() {
    Text = "TigerIQ Phone Farm | Windows Local";
    Width = 1570;
    Height = 940;
    MinimumSize = new Size(940, 620);
    StartPosition = FormStartPosition.CenterScreen;
    AutoScaleMode = AutoScaleMode.Dpi;
    Controls.Add(viewer);
    Controls.Add(loading);
    viewer.Visible = false;
    Shown += async (_, _) => await StartupAsync();
    FormClosed += (_, _) => ShutdownOwnedHost();
  }

  private static async Task<bool> HealthyAsync(HttpClient client) {
    try {
      var response = await client.GetAsync(Origin + "/api/health");
      if (!response.IsSuccessStatusCode) return false;
      var content = await response.Content.ReadAsStringAsync();
      return content.Contains("\"localOnly\":true", StringComparison.Ordinal);
    } catch { return false; }
  }

  private void StartBackend() {
    string executable = Path.Combine(appDirectory, "node.exe");
    if (!File.Exists(executable)) executable = Path.Combine(
      Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe");
    if (!File.Exists(executable)) throw new FileNotFoundException(
      "Không tìm thấy Node.js trên máy. Cần node.exe trong thư mục ứng dụng.", executable);

    string entry = Path.Combine(appDirectory, "app.mjs");
    if (!File.Exists(entry)) throw new FileNotFoundException(
      "Bộ điều khiển app.mjs không có trong thư mục ứng dụng.", entry);

    var start = new ProcessStartInfo(executable) {
      Arguments = "\"" + entry + "\"",
      WorkingDirectory = appDirectory,
      UseShellExecute = false,
      CreateNoWindow = true,
      WindowStyle = ProcessWindowStyle.Hidden
    };
    start.Environment["TIGERIQ_PHONE_FARM_PORT"] = "8765";
    // Prefer explicit user configuration; the Node controller also checks local paths.
    ownedHost = Process.Start(start) ?? throw new InvalidOperationException(
      "Không thể khởi động bộ điều khiển.");
  }

  private async Task StartupAsync() {
    try {
      using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(1) };
      if (!await HealthyAsync(client)) StartBackend();

      bool ready = false;
      for (int retry = 0; retry < 60; retry++) {
        if (await HealthyAsync(client)) { ready = true; break; }
        if (ownedHost is { HasExited: true }) break;
        await Task.Delay(150);
      }
      if (!ready) throw new InvalidOperationException(
        "Không thể kết nối bộ điều khiển tại 127.0.0.1:8765. " +
        "Kiểm tra cổng đang được sử dụng và quyền ADB trên PC.");

      string userFolder = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "TigerIQ", "PhoneFarm", "WebView2");
      Directory.CreateDirectory(userFolder);
      var environment = await CoreWebView2Environment.CreateAsync(null, userFolder);
      await viewer.EnsureCoreWebView2Async(environment);
      viewer.CoreWebView2.Settings.AreDevToolsEnabled = false;
      viewer.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
      viewer.CoreWebView2.Settings.IsPasswordAutosaveEnabled = false;
      viewer.CoreWebView2.NavigationStarting += (_, args) => {
        if (args.Uri == "about:blank") return;
        if (!Uri.TryCreate(args.Uri, UriKind.Absolute, out var uri) ||
            uri.Scheme != Uri.UriSchemeHttp ||
            uri.Host != "127.0.0.1" || uri.Port != 8765)
          args.Cancel = true;
      };
      viewer.Source = new Uri(Origin + "/");
      loading.Visible = false;
      viewer.Visible = true;
      viewer.BringToFront();
    } catch (Exception ex) {
      loading.Text = "KHÔNG KHỞI ĐỘNG ĐƯỢC\n\n" + ex.Message + "\n\n" +
                     "Dữ liệu và ứng dụng LAIXI cũ không bị thay đổi.";
      loading.ForeColor = Color.Firebrick;
      ShutdownOwnedHost();
    }
  }

  private void ShutdownOwnedHost() {
    try {
      if (ownedHost is { HasExited: false }) {
        ownedHost.Kill(entireProcessTree: true);
        ownedHost.WaitForExit(2500);
      }
    } catch (Exception) {
      // The process belongs to the current desktop instance only.
    } finally {
      ownedHost?.Dispose();
      ownedHost = null;
    }
  }
}
