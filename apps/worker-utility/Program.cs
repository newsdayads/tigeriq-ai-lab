using Microsoft.Win32;
using System.Text.Json;

namespace TigerIQ.WorkerUtility;

internal static class Program
{
    [STAThread]
    static void Main(string[] args)
    {
        if (args.Contains("--self-test", StringComparer.OrdinalIgnoreCase))
        {
            Environment.Exit(SelfTest.Run());
            return;
        }
        using var mutex = new Mutex(true, "Local\\TigerIQ.WorkerUtility.V1", out var created);
        if (!created) return;
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        var app = new UtilityContext();
        Application.Run(app);
    }
}
