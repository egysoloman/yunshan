using System.Diagnostics;
using System.IO;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEngine;
using Yunshan.Core.Host;
using Debug = UnityEngine.Debug;

namespace Yunshan.Editor
{
    /// <summary>Prepares StreamingAssets/yunshan-sim for a standalone player:
    /// the bundled authoritative simulation (npm run build:sim-host) and a copy
    /// of this machine's Node.js. A player build is refused without the bundle,
    /// because the player cannot run the repository sources.</summary>
    public static class StandaloneHostPrep
    {
        static string Repository => Path.GetFullPath(Path.Combine(Application.dataPath, "..", ".."));
        static string SimDirectory => Path.Combine(Application.streamingAssetsPath, "yunshan-sim");
        public static string BundlePath => Path.Combine(SimDirectory, "sim-host.mjs");

        [MenuItem("云山/准备独立打包：生成模拟宿主并复制 Node.js")]
        public static void Prepare()
        {
            var node = HostLaunch.FindNode(null);
            if (node == null) { EditorUtility.DisplayDialog("云山", "未找到 Node.js 22 或更高版本。请安装后重试，或设置环境变量 YUNSHAN_NODE。", "好"); return; }
            var script = Path.Combine(Repository, "scripts", "build-sim-host.mjs");
            if (!File.Exists(script)) { EditorUtility.DisplayDialog("云山", $"未找到 {script}。本菜单需要在仓库内的 unity/ 工程中使用。", "好"); return; }
            if (!Directory.Exists(Path.Combine(Repository, "node_modules", "esbuild"))) { EditorUtility.DisplayDialog("云山", "请先在仓库根目录执行 npm install。", "好"); return; }
            var start = new ProcessStartInfo(node, $"\"{script}\"") { WorkingDirectory = Repository, UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true };
            using (var process = Process.Start(start))
            {
                string output = process.StandardOutput.ReadToEnd(), error = process.StandardError.ReadToEnd();
                process.WaitForExit();
                if (process.ExitCode != 0 || !File.Exists(BundlePath)) { Debug.LogError($"云山：生成模拟宿主失败（退出码 {process.ExitCode}）\n{output}\n{error}"); return; }
                Debug.Log($"云山：模拟宿主已生成 {BundlePath}\n{output}");
            }
            // The copied runtime matches this machine's OS and CPU. Build each
            // target platform on that platform, or replace node/ by hand.
            var targetDirectory = Path.Combine(SimDirectory, "node");
            Directory.CreateDirectory(targetDirectory);
            var target = Path.Combine(targetDirectory, Path.GetFileName(node));
            File.Copy(node, target, true);
            Debug.Log($"云山：已复制 Node.js {node} → {target}（仅适用于与本机相同的系统与架构）。");
            AssetDatabase.Refresh();
        }

        sealed class RequireBundle : IPreprocessBuildWithReport
        {
            public int callbackOrder => 0;
            public void OnPreprocessBuild(BuildReport report)
            {
                if (!File.Exists(BundlePath)) throw new BuildFailedException($"云山：缺少 {BundlePath}。请先运行菜单「云山/准备独立打包：生成模拟宿主并复制 Node.js」。");
                if (!Directory.Exists(Path.Combine(SimDirectory, "node"))) Debug.LogWarning("云山：StreamingAssets/yunshan-sim/node 不存在；玩家机器需自行安装 Node.js 22+。");
            }
        }
    }
}
