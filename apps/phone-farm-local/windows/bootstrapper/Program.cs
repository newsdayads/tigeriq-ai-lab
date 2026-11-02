using System.Diagnostics;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;

namespace TigerIQPhoneFarmBootstrapper;

internal static class Program {
  private const string PackageUrl =
    "https://github.com/newsdayads/tigeriq-ai-lab/releases/download/tigeriq-phone-farm-windows-v0.5.0-rc6/TigerIQ-PhoneFarm-Windows-v0.5.0-RC6-d64b2a04.zip";
  private const string PackageSha256 =
    "bd8375a8712ee8bc18d725bd45e3652414946b9eb834de6879c2c42ff8a30709";
  private const string BaseSourceHead =
    "d64b2a04558533d0a8690fc9a2ef11fe74d47596";
  private const string OverlaySourceHead =
    "43a73553c7494d770d907e9f93c4786c9c897b0a";
  private const string AppOverlayResource =
    "TigerIQPhoneFarmBootstrapper.Overlay.app.mjs";
  private const string UiOverlayResource =
    "TigerIQPhoneFarmBootstrapper.Overlay.ui.js";
  private const string RecordingOverlayResource =
    "TigerIQPhoneFarmBootstrapper.Overlay.recording.mjs";
  private const long MaxPackageBytes = 160L * 1024 * 1024;
  private const long MaxExtractedBytes = 450L * 1024 * 1024;
  private const int MaxEntries = 2500;

  [STAThread]
  private static int Main(string[] args) {
    if (args.Length == 1 && args[0] == "--verify-config")
      return VerifyStaticConfig() ? 0 : 20;

    if (Process.GetCurrentProcess().SessionId == 0 || !Environment.UserInteractive)
      return 12;

    ApplicationConfiguration.Initialize();
    try {
      string? localPackagePath = ParseLocalPackageArgument(args);
      DeployAsync(localPackagePath).GetAwaiter().GetResult();
      return 0;
    } catch (Exception ex) {
      MessageBox.Show(
        "Không thể triển khai TigerIQ Phone Farm RC6 + overlay.\n\n" + ex.Message +
        "\n\nKhông có firewall, tài khoản, ADB mode hoặc cấu hình mạng nào bị thay đổi.",
        "TigerIQ Phone Farm Bootstrapper",
        MessageBoxButtons.OK,
        MessageBoxIcon.Error);
      return 1;
    }
  }

  private static bool VerifyStaticConfig() {
    if (!Uri.TryCreate(PackageUrl, UriKind.Absolute, out var uri)) return false;
    if (uri.Scheme != Uri.UriSchemeHttps ||
        !string.Equals(uri.Host, "github.com", StringComparison.OrdinalIgnoreCase)) return false;
    if (!uri.AbsolutePath.StartsWith(
          "/newsdayads/tigeriq-ai-lab/releases/download/tigeriq-phone-farm-windows-v0.5.0-rc6/",
          StringComparison.Ordinal)) return false;
    if (!IsHex(PackageSha256, 64) || !IsHex(BaseSourceHead, 40) || !IsHex(OverlaySourceHead, 40))
      return false;

    var assembly = Assembly.GetExecutingAssembly();
    using var app = assembly.GetManifestResourceStream(AppOverlayResource);
    using var ui = assembly.GetManifestResourceStream(UiOverlayResource);
    using var recording = assembly.GetManifestResourceStream(RecordingOverlayResource);
    return app is not null && app.Length > 0 && ui is not null && ui.Length > 0 &&
      recording is not null && recording.Length > 0;
  }

  private static string? ParseLocalPackageArgument(string[] args) {
    if (args.Length == 0) return null;
    if (args.Length != 2 || !args[0].Equals("--package", StringComparison.OrdinalIgnoreCase))
      throw new ArgumentException("Tham số hợp lệ: --package <đường-dẫn-tuyệt-đối-tới-RC6.zip>.");

    string raw = args[1];
    if (!Path.IsPathFullyQualified(raw))
      throw new ArgumentException("Đường dẫn gói RC6 cục bộ phải là đường dẫn tuyệt đối.");

    string fullPath = Path.GetFullPath(raw);
    if (!Path.GetExtension(fullPath).Equals(".zip", StringComparison.OrdinalIgnoreCase))
      throw new ArgumentException("Gói RC6 cục bộ phải là tệp ZIP.");

    var info = new FileInfo(fullPath);
    if (!info.Exists || info.Length <= 0 || info.Length > MaxPackageBytes)
      throw new InvalidDataException("Gói RC6 cục bộ không tồn tại, rỗng hoặc vượt giới hạn.");

    return fullPath;
  }

  private static async Task DeployAsync(string? localPackagePath) {
    if (!VerifyStaticConfig()) throw new InvalidOperationException("Cấu hình phát hành không hợp lệ.");
    if (localPackagePath is not null) VerifyPinnedLocalPackage(localPackagePath);

    string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
    if (string.IsNullOrWhiteSpace(local)) throw new InvalidOperationException("Không xác định được LOCALAPPDATA.");

    string root = Path.Combine(local, "TigerIQ", "PhoneFarm");
    string releases = Path.Combine(root, "releases");
    string target = Path.Combine(releases, BaseSourceHead[..8]);
    Directory.CreateDirectory(releases);

    string packageOrigin = "existing-verified-install";
    if (!Directory.Exists(target)) {
      string staging = Path.Combine(releases, ".staging-" + Guid.NewGuid().ToString("N"));
      string cache = Path.Combine(root, "bootstrap-cache");
      Directory.CreateDirectory(cache);
      string zip = Path.Combine(cache, "TigerIQ-PhoneFarm-Windows-v0.5.0-RC6-d64b2a04.zip");

      try {
        packageOrigin = localPackagePath is null ? "github-https" : "verified-local";
        await PreparePinnedPackageAsync(zip, localPackagePath);
        string actual = HashFile(zip);
        if (!actual.Equals(PackageSha256, StringComparison.OrdinalIgnoreCase))
          throw new InvalidDataException("SHA-256 gói RC6 không khớp.");

        ExtractSafe(zip, staging);
        VerifyExtractedRelease(staging);

        try {
          Directory.Move(staging, target);
        } catch (IOException) when (Directory.Exists(target)) {
          Directory.Delete(staging, recursive: true);
          VerifyExtractedRelease(target);
        }
      } finally {
        TryDeleteFile(zip);
        TryDeleteDirectory(staging);
      }
    } else {
      VerifyExtractedRelease(target);
    }

    ApplyOverlay(target);
    var overlayHashes = VerifyOverlay(target);
    WriteOverlayReceipt(target, overlayHashes.AppSha256, overlayHashes.UiSha256, overlayHashes.RecordingSha256);
    WriteCurrentReceipt(
      root,
      target,
      overlayHashes.AppSha256,
      overlayHashes.UiSha256,
      overlayHashes.RecordingSha256,
      packageOrigin);
    RestartTarget(target);

    MessageBox.Show(
      "Đã triển khai TigerIQ Phone Farm RC6 + overlay backend/UI đã xác minh.\n\n" +
      "Base: " + BaseSourceHead + "\n" +
      "Overlay: " + OverlaySourceHead + "\n" +
      "Nguồn gói: " + packageOrigin + "\n" +
      "Gói RC6: SHA-256 " + PackageSha256,
      "TigerIQ Phone Farm Bootstrapper",
      MessageBoxButtons.OK,
      MessageBoxIcon.Information);
  }

  private static void VerifyPinnedLocalPackage(string localPackagePath) {
    var info = new FileInfo(localPackagePath);
    if (!info.Exists || info.Length <= 0 || info.Length > MaxPackageBytes)
      throw new InvalidDataException("Kích thước gói RC6 cục bộ vượt giới hạn.");
    string actual = HashFile(localPackagePath);
    if (!actual.Equals(PackageSha256, StringComparison.OrdinalIgnoreCase))
      throw new InvalidDataException("SHA-256 gói RC6 cục bộ không khớp gói đã ghim.");
  }

  private static async Task PreparePinnedPackageAsync(string destination, string? localPackagePath) {
    if (localPackagePath is null) {
      await DownloadPinnedPackageAsync(destination);
      return;
    }

    VerifyPinnedLocalPackage(localPackagePath);
    TryDeleteFile(destination);
    long total = 0;
    await using (var input = new FileStream(
      localPackagePath, FileMode.Open, FileAccess.Read, FileShare.Read, 1024 * 1024,
      FileOptions.SequentialScan)) {
      await using var output = new FileStream(
        destination, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1024 * 1024,
        FileOptions.SequentialScan);
      byte[] buffer = new byte[1024 * 1024];
      int read;
      while ((read = await input.ReadAsync(buffer)) > 0) {
        total += read;
        if (total > MaxPackageBytes)
          throw new InvalidDataException("Gói RC6 cục bộ vượt giới hạn sao chép.");
        await output.WriteAsync(buffer.AsMemory(0, read));
      }
      await output.FlushAsync();
    }

    if (total == 0) throw new InvalidDataException("Gói RC6 cục bộ rỗng.");
    string copiedHash = HashFile(destination);
    if (!copiedHash.Equals(PackageSha256, StringComparison.OrdinalIgnoreCase))
      throw new InvalidDataException("SHA-256 bản sao gói RC6 cục bộ không khớp gói đã ghim.");
  }

  private static async Task DownloadPinnedPackageAsync(string destination) {
    TryDeleteFile(destination);
    using var client = new HttpClient(new HttpClientHandler {
      AllowAutoRedirect = true,
      MaxAutomaticRedirections = 5
    }) {
      Timeout = TimeSpan.FromMinutes(5)
    };
    client.DefaultRequestHeaders.UserAgent.ParseAdd("TigerIQ-PhoneFarm-Bootstrapper/1.6");

    using var response = await client.GetAsync(PackageUrl, HttpCompletionOption.ResponseHeadersRead);
    response.EnsureSuccessStatusCode();
    if (response.Content.Headers.ContentLength is long length &&
        (length <= 0 || length > MaxPackageBytes))
      throw new InvalidDataException("Kích thước gói RC6 vượt giới hạn.");

    await using var input = await response.Content.ReadAsStreamAsync();
    await using var output = new FileStream(
      destination, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1024 * 1024,
      FileOptions.SequentialScan);

    byte[] buffer = new byte[1024 * 1024];
    long total = 0;
    int read;
    while ((read = await input.ReadAsync(buffer)) > 0) {
      total += read;
      if (total > MaxPackageBytes)
        throw new InvalidDataException("Gói RC6 vượt giới hạn tải xuống.");
      await output.WriteAsync(buffer.AsMemory(0, read));
    }
    if (total == 0) throw new InvalidDataException("Gói RC6 tải xuống rỗng.");
  }

  private static void ExtractSafe(string zipPath, string destination) {
    Directory.CreateDirectory(destination);
    string root = Path.GetFullPath(destination)
      .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) +
      Path.DirectorySeparatorChar;
    long total = 0;
    int count = 0;

    using var archive = ZipFile.OpenRead(zipPath);
    foreach (var entry in archive.Entries) {
      if (++count > MaxEntries) throw new InvalidDataException("Gói RC6 có quá nhiều tệp.");
      if (entry.FullName.Contains('\0') || entry.FullName.Contains(':'))
        throw new InvalidDataException("Tên tệp ZIP không hợp lệ.");
      int unixType = (entry.ExternalAttributes >> 16) & 0xF000;
      if (unixType == 0xA000) throw new InvalidDataException("Không chấp nhận symbolic link trong gói.");

      string relative = entry.FullName.Replace('/', Path.DirectorySeparatorChar);
      string path = Path.GetFullPath(Path.Combine(destination, relative));
      if (!path.StartsWith(root, StringComparison.OrdinalIgnoreCase))
        throw new InvalidDataException("Phát hiện đường dẫn ZIP vượt thư mục đích.");

      if (string.IsNullOrEmpty(entry.Name)) {
        Directory.CreateDirectory(path);
        continue;
      }

      total += entry.Length;
      if (entry.Length < 0 || total > MaxExtractedBytes)
        throw new InvalidDataException("Dung lượng giải nén RC6 vượt giới hạn.");

      Directory.CreateDirectory(Path.GetDirectoryName(path)!);
      using var source = entry.Open();
      using var output = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None);
      source.CopyTo(output);
    }
  }

  private static void VerifyExtractedRelease(string directory) {
    string manifestPath = Path.Combine(directory, "BUILD_MANIFEST.json");
    string exePath = Path.Combine(directory, "TigerIQPhoneFarm.exe");
    if (!File.Exists(manifestPath) || !File.Exists(exePath))
      throw new InvalidDataException("Gói RC6 thiếu manifest hoặc EXE.");

    using var doc = JsonDocument.Parse(File.ReadAllText(manifestPath));
    var root = doc.RootElement;
    string source = root.GetProperty("sourceHead").GetString() ?? "";
    string expectedExe = root.GetProperty("tigeriqExeSha256").GetString() ?? "";
    if (!source.Equals(BaseSourceHead, StringComparison.OrdinalIgnoreCase))
      throw new InvalidDataException("sourceHead trong BUILD_MANIFEST không khớp.");
    if (!IsHex(expectedExe, 64))
      throw new InvalidDataException("SHA-256 EXE trong BUILD_MANIFEST không hợp lệ.");

    string actualExe = HashFile(exePath);
    if (!actualExe.Equals(expectedExe, StringComparison.OrdinalIgnoreCase))
      throw new InvalidDataException("SHA-256 TigerIQPhoneFarm.exe không khớp manifest.");

    foreach (string required in new[] { "app.mjs", "node.exe", "ui.js", "WebView2Loader.dll" })
      if (!File.Exists(Path.Combine(directory, required)))
        throw new InvalidDataException("Gói RC6 thiếu " + required + ".");
  }

  private static void ApplyOverlay(string directory) {
    WriteEmbeddedResourceAtomic(
      Path.Combine(directory, "app.mjs"),
      AppOverlayResource);
    WriteEmbeddedResourceAtomic(
      Path.Combine(directory, "ui.js"),
      UiOverlayResource);
    WriteEmbeddedResourceAtomic(
      Path.Combine(directory, "recording.mjs"),
      RecordingOverlayResource);
  }

  private static (string AppSha256, string UiSha256, string RecordingSha256) VerifyOverlay(string directory) {
    string appPath = Path.Combine(directory, "app.mjs");
    string uiPath = Path.Combine(directory, "ui.js");
    string recordingPath = Path.Combine(directory, "recording.mjs");
    string appExpected = HashEmbeddedResource(AppOverlayResource);
    string uiExpected = HashEmbeddedResource(UiOverlayResource);
    string recordingExpected = HashEmbeddedResource(RecordingOverlayResource);
    string appActual = HashFile(appPath);
    string uiActual = HashFile(uiPath);
    string recordingActual = HashFile(recordingPath);

    if (!appActual.Equals(appExpected, StringComparison.OrdinalIgnoreCase))
      throw new InvalidDataException("SHA-256 overlay app.mjs không khớp.");
    if (!uiActual.Equals(uiExpected, StringComparison.OrdinalIgnoreCase))
      throw new InvalidDataException("SHA-256 overlay ui.js không khớp.");
    if (!recordingActual.Equals(recordingExpected, StringComparison.OrdinalIgnoreCase))
      throw new InvalidDataException("SHA-256 overlay recording.mjs không khớp.");

    return (appActual, uiActual, recordingActual);
  }

  private static void WriteEmbeddedResourceAtomic(string destination, string resourceName) {
    var assembly = Assembly.GetExecutingAssembly();
    using var input = assembly.GetManifestResourceStream(resourceName)
      ?? throw new InvalidDataException("Thiếu embedded overlay: " + resourceName);

    string temp = destination + ".overlay-" + Guid.NewGuid().ToString("N") + ".tmp";
    try {
      using (var output = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None)) {
        input.CopyTo(output);
        output.Flush(flushToDisk: true);
      }
      File.Move(temp, destination, overwrite: true);
    } finally {
      TryDeleteFile(temp);
    }
  }

  private static string HashEmbeddedResource(string resourceName) {
    using var input = Assembly.GetExecutingAssembly().GetManifestResourceStream(resourceName)
      ?? throw new InvalidDataException("Thiếu embedded overlay: " + resourceName);
    return Convert.ToHexString(SHA256.HashData(input)).ToLowerInvariant();
  }

  private static void WriteOverlayReceipt(
    string directory,
    string appSha256,
    string uiSha256,
    string recordingSha256) {
    var receipt = new {
      schema = "TIGERIQ_PHONE_FARM_OVERLAY_V1",
      baseSourceHead = BaseSourceHead,
      overlaySourceHead = OverlaySourceHead,
      appSha256,
      uiSha256,
      recordingSha256,
      appliedAtUtc = DateTime.UtcNow.ToString("O"),
      localOnly = true
    };
    WriteJsonAtomic(
      Path.Combine(directory, "TIGERIQ_OVERLAY.json"),
      receipt);
  }

  private static void WriteCurrentReceipt(
    string root,
    string installPath,
    string appSha256,
    string uiSha256,
    string recordingSha256,
    string packageOrigin) {
    var receipt = new {
      schema = "TIGERIQ_PHONE_FARM_CURRENT_RELEASE_V2",
      baseSourceHead = BaseSourceHead,
      overlaySourceHead = OverlaySourceHead,
      packageSha256 = PackageSha256,
      packageOrigin,
      internetRequiredForInstall = packageOrigin == "github-https",
      runtimeInternetRequired = false,
      appSha256,
      uiSha256,
      recordingSha256,
      installPath,
      verifiedAtUtc = DateTime.UtcNow.ToString("O"),
      localOnly = true
    };
    WriteJsonAtomic(
      Path.Combine(root, "CURRENT_RELEASE.json"),
      receipt);
  }

  private static void WriteJsonAtomic(string destination, object value) {
    string temp = destination + ".tmp-" + Guid.NewGuid().ToString("N");
    try {
      File.WriteAllText(
        temp,
        JsonSerializer.Serialize(value, new JsonSerializerOptions { WriteIndented = true }));
      File.Move(temp, destination, overwrite: true);
    } finally {
      TryDeleteFile(temp);
    }
  }

  private static void RestartTarget(string directory) {
    string exe = Path.GetFullPath(Path.Combine(directory, "TigerIQPhoneFarm.exe"));
    StopTargetProcesses(exe);
    Launch(directory);
  }

  private static void StopTargetProcesses(string expectedExe) {
    foreach (var process in Process.GetProcessesByName("TigerIQPhoneFarm")) {
      using (process) {
        string? actualExe;
        try {
          actualExe = process.MainModule?.FileName;
        } catch {
          continue;
        }
        if (string.IsNullOrWhiteSpace(actualExe) ||
            !Path.GetFullPath(actualExe).Equals(expectedExe, StringComparison.OrdinalIgnoreCase))
          continue;

        try {
          if (!process.HasExited && process.CloseMainWindow())
            process.WaitForExit(5000);
          if (!process.HasExited) {
            process.Kill(entireProcessTree: true);
            process.WaitForExit(5000);
          }
        } catch (InvalidOperationException) {
        }
      }
    }

    foreach (var process in Process.GetProcessesByName("TigerIQPhoneFarm")) {
      using (process) {
        try {
          string? actualExe = process.MainModule?.FileName;
          if (!string.IsNullOrWhiteSpace(actualExe) &&
              Path.GetFullPath(actualExe).Equals(expectedExe, StringComparison.OrdinalIgnoreCase) &&
              !process.HasExited)
            throw new InvalidOperationException("Không thể dừng đúng tiến trình TigerIQ Phone Farm để áp overlay.");
        } catch (System.ComponentModel.Win32Exception) {
        }
      }
    }
  }

  private static void Launch(string directory) {
    string exe = Path.Combine(directory, "TigerIQPhoneFarm.exe");
    var started = Process.Start(new ProcessStartInfo(exe) {
      WorkingDirectory = directory,
      UseShellExecute = false
    });
    if (started is null) throw new InvalidOperationException("Không thể mở TigerIQPhoneFarm.exe.");
  }

  private static string HashFile(string path) {
    using var stream = File.OpenRead(path);
    return Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
  }

  private static bool IsHex(string value, int length) =>
    value.Length == length && value.All(Uri.IsHexDigit);

  private static void TryDeleteFile(string path) {
    try { if (File.Exists(path)) File.Delete(path); } catch { }
  }

  private static void TryDeleteDirectory(string path) {
    try { if (Directory.Exists(path)) Directory.Delete(path, recursive: true); } catch { }
  }
}
