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
        if (args.Contains("--binding-diagnostic", StringComparer.OrdinalIgnoreCase))
        {
            var binder = new WindowBinder();
            foreach (var w in Workers.All)
            {
                var ok = binder.TryResolve(w.Id, out var hwnd, out var rect);
                Console.WriteLine($"{w.Id};ok={ok};hwnd={hwnd};rect={rect.Left},{rect.Top},{rect.Right},{rect.Bottom}");
            }
            return;
        }
        using var mutex = new Mutex(true, "Local\\TigerIQ.WorkerUtility.V1", out var created);
        if (!created) return;
        Application.SetHighDpiMode(HighDpiMode.DpiUnaware);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new UtilityContext());
    }
}
