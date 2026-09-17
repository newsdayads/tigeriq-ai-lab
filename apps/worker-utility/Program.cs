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
        if (System.Diagnostics.Process.GetCurrentProcess().SessionId == 0)
        {
            Environment.Exit(42);
            return;
        }
        using var mutex = new Mutex(true, "Local\\TigerIQ.WorkerUtility.V1", out var created);
        if (!created) return;
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new UtilityContext());
    }
}