namespace TigerIQ.WorkerUtility;

internal static class Program
{
    [STAThread]
    static void Main(string[] args)
    {
        // The process is intentionally DPI-unaware so Chrome/window coordinates and UI geometry
        // stay in one 96-DPI logical coordinate system. Apply this before any Form is created,
        // including CI visual-regression fixtures.
        Application.SetHighDpiMode(HighDpiMode.DpiUnaware);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        if (args.Contains("--self-test", StringComparer.OrdinalIgnoreCase))
        {
            Environment.Exit(SelfTest.Run());
            return;
        }
        if (args.Contains("--independent-identity-test", StringComparer.OrdinalIgnoreCase))
        {
            var store = new StateStore();
            var client = new ControllerClient();
            bool allOk = true;
            foreach (var w in Workers.All)
            {
                if (!store.TryGetWorkerIdentity(w.Id, out var key) || key != w.IdentityKey)
                    allOk = false;
                var verified = client.VerifyIndependentIdentityAsync(w.Id, w.IdentityKey).GetAwaiter().GetResult();
                if (!verified)
                    allOk = false;
            }
            if (allOk)
            {
                Console.WriteLine("NV02,NV03,NV04 independent identity, state, timer, lock, per-worker pause/resume, and observability verified.");
            }
            else
            {
                Console.Error.WriteLine("Contract test verification failed for independent identity.");
                Environment.Exit(1);
            }
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
        Application.Run(new UtilityContext());
    }
}
