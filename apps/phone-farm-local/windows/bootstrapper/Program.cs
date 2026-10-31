using System.Diagnostics;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;

namespace TigerIQPhoneFarmBootstrapper;

internal static class Program {
  private const string PackageUrl =
    "https://github.com/newsdayads/tigeriq-ai-lab/releases/download/tigeriq-phone-farm-windows-v0.5.0-rc5/TigerIQ-PhoneFarm-Windows-v0.5.0-RC5-6c053a24.zip";
  private const string PackageSha256 =
    "cb2c5dfb559bad23e95122b1e5f285f48d541ee0c973c2ec7b6f09dc54b4992";
  private const string SourceHead =
    "6c053a242cca672f0a3f3356d995576b9b8d6058";
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
      DeployAsync().GetAwaiter().GetResult();
      return 0;
    } catch (Exception ex) {
      MessageBox.Show(
        "Không thể triển khai TigerIQ Phone Farm RC5.\n\n" + ex.Message +
        "\n\nKhông có firewall, tài khoản, LAIXI hoặc cấu hình hệ thống nào bị thay đổi.",
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
          "/newsdayads/tigeriq-ai-lab/releases/download/tigeriq-phone-farm-windows-v0.5.0-rc5/",
          StringComparison.Ordinal)) return false;
    return IsHex(PackageSha256, 64) && IsHex(SourceHead, 40);
  }

  private static async Task DeployAsync() {
    if (!VerifyStaticConfig()) throw new InvalidOperationException("Cấu hình phát hành không hợp lệ.");

    string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
    if (string.IsNullOrWhiteSpace(local)) throw new InvalidOperationException("Không xác định được LOCALAPPDATA.");

    string root = Path.Combine(local, "TigerIQ", "PhoneFarm");
    string releases = Path.Combine(root, "releases");
    string target = Path.Combine(releases, SourceHead[..8]);
    Directory.CreateDirectory(releases);

    if (Directory.Exists(target)) {
      VerifyExtractedRelease(target);
      WriteCurrentReceipt(root, target);
      Launch(target);
      MessageBox.Show(
        "RC5 đúng SHA đã tồn tại và đã được mở.\n\nNguồn: " + SourceHead,
        "TigerIQ Phone Farm Bootstrapper",
        MessageBoxButtons.OK,
        MessageBoxIcon.Information);
      return;
    }

    string staging = Path.Combine(releases, ".staging-" + Guid.NewGuid().ToString("N"));
    string cache = Path.Combine(root, "bootstrap-cache");
    Directory.CreateDirectory(cache);
    string zip = Path.Combine(cache, "TigerIQ-PhoneFarm-Windows-v0.5.0-RC5-6c053a24.zip");

    try {
      await DownloadPinnedPackageAsync(zip);
      string actual = HashFile(zip);
      if (!actual.Equals(PackageSha256, StringComparison.OrdinalIgnoreCase))
        throw new InvalidDataException("SHA-256 gói RC5 không khớp.");

      ExtractSafe(zip, staging);
      VerifyExtractedRelease(staging);

      try {
        Directory.Move(staging, target);
      } catch (IOException) when (Directory.Exists(target)) {
        Directory.Delete(staging, recursive: true);
        VerifyExtractedRelease(target);
      }

      WriteCurrentReceipt(root, target);
      Launch(target);
      MessageBox.Show(
        "Đã triển khai và mở TigerIQ Phone Farm RC5.\n\n" +
        "Nguồn: " + SourceHead + "\n" +
        "Gói: SHA-256 " + PackageSha256,
        "TigerIQ Phone Farm Bootstrapper",
        MessageBoxButtons.OK,
        MessageBoxIcon.Information);
    } finally {
      TryDeleteFile(zip);
      TryDeleteDirectory(staging);
    }
  }

  private static async Task DownloadPinnedPackageAsync(string destination) {
    TryDeleteFile(destination);
    using var client = new HttpClient(new HttpClientHandler {
      AllowAutoRedirect = true,
      MaxAutomaticRedirections = 5
    }) {
      Timeout = TimeSpan.FromMinutes(5)
    };
    client.DefaultRequestHeaders.UserAgent.ParseAdd("TigerIQ-PhoneFarm-Bootstrapper/1.0");

    using var response = await client.GetAsync(PackageUrl, HttpCompletionOption.ResponseHeadersRead);
    response.EnsureSuccessStatusCode();
    if (response.Content.Headers.ContentLength is long length &&
        (length <= 0 || length > MaxPackageBytes))
      throw new InvalidDataException("Kích thước gói RC5 vượt giới hạn.");

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
        throw new InvalidDataException("Gói RC5 vượt giới hạn tải xuống.");
      await output.WriteAsync(buffer.AsMemory(0, read));
    }
    if (total == 0) throw new InvalidDataException("Gói RC5 tải xuống rỗng.");
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
      if (++count > MaxEntries) throw new InvalidDataException("Gói RC5 có quá nhiều tệp.");
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
        throw new InvalidDataException("Dung lượng giải nén RC5 vượt giới hạn.");

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
      throw new InvalidDataException("Gói RC5 thiếu manifest hoặc EXE.");

    using var doc = JsonDocument.Parse(File.ReadAllText(manifestPath));
    var root = doc.RootElement;
    string source = root.GetProperty("sourceHead").GetString() ?? "";
    string expectedExe = root.GetProperty("tigeriqExeSha256").GetString() ?? "";
    if (!source.Equals(SourceHead, StringComparison.OrdinalIgnoreCase))
      throw new InvalidDataException("sourceHead trong BUILD_MANIFEST không khớp.");
    if (!IsHex(expectedExe, 64))
      throw new InvalidDataException("SHA-256 EXE trong BUILD_MANIFEST không hợp lệ.");

    string actualExe = HashFile(exePath);
    if (!actualExe.Equals(expectedExe, StringComparison.OrdinalIgnoreCase))
      throw new InvalidDataException("SHA-256 TigerIQPhoneFarm.exe không khớp manifest.");

    foreach (string required in new[] { "app.mjs", "node.exe", "ui.js", "WebView2Loader.dll" })
      if (!File.Exists(Path.Combine(directory, required)))
        throw new InvalidDataException("Gói RC5 thiếu " + required + ".");
  }

  private static void WriteCurrentReceipt(string root, string installPath) {
    var receipt = new {
      schema = "TIGERIQ_PHONE_FARM_CURRENT_RELEASE_V1",
      sourceHead = SourceHead,
      packageSha256 = PackageSha256,
      installPath,
      verifiedAtUtc = DateTime.UtcNow.ToString("O"),
      localOnly = true
    };
    File.WriteAllText(
      Path.Combine(root, "CURRENT_RELEASE.json"),
      JsonSerializer.Serialize(receipt, new JsonSerializerOptions { WriteIndented = true }));
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
