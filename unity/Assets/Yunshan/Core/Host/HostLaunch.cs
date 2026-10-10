using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace Yunshan.Core.Host
{
    /// <summary>How to start the simulation host: the bundled
    /// StreamingAssets/yunshan-sim/sim-host.mjs when present, otherwise the
    /// repository's TypeScript entry through tsx (development checkout).</summary>
    public sealed class HostLaunch
    {
        public string Node; public List<string> Arguments = new List<string>(); public string WorkingDirectory; public string Description;

        /// <summary>Node.js 22+ executable: $YUNSHAN_NODE, then a bundled
        /// runtime beside the host bundle, then common install locations
        /// (GUI apps on macOS do not inherit the shell PATH), then PATH.</summary>
        public static string FindNode(string bundleDirectory = null)
        {
            var candidates = new List<string>();
            var env = Environment.GetEnvironmentVariable("YUNSHAN_NODE");
            if (!string.IsNullOrEmpty(env)) candidates.Add(env);
            bool windows = Path.DirectorySeparatorChar == '\\';
            string exe = windows ? "node.exe" : "node";
            if (bundleDirectory != null) candidates.Add(Path.Combine(bundleDirectory, "node", exe));
            if (!windows)
            {
                candidates.AddRange(new[] { "/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node", "/opt/node22/bin/node" });
                var home = Environment.GetEnvironmentVariable("HOME");
                if (!string.IsNullOrEmpty(home))
                {
                    var nvm = Path.Combine(home, ".nvm", "versions", "node");
                    if (Directory.Exists(nvm)) candidates.AddRange(Directory.GetDirectories(nvm).OrderByDescending(d => d, StringComparer.Ordinal).Select(d => Path.Combine(d, "bin", "node")));
                    candidates.Add(Path.Combine(home, ".volta", "bin", "node"));
                }
            }
            else
            {
                var programFiles = Environment.GetEnvironmentVariable("ProgramFiles");
                if (!string.IsNullOrEmpty(programFiles)) candidates.Add(Path.Combine(programFiles, "nodejs", exe));
            }
            foreach (var dir in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator)) if (dir.Length > 0) candidates.Add(Path.Combine(dir, exe));
            return candidates.FirstOrDefault(File.Exists);
        }

        public static HostLaunch Resolve(string bundleDirectory, string repositoryRoot)
        {
            var node = FindNode(bundleDirectory);
            if (node == null) return null;
            var bundle = bundleDirectory == null ? null : Path.Combine(bundleDirectory, "sim-host.mjs");
            if (bundle != null && File.Exists(bundle))
                return new HostLaunch { Node = node, Arguments = { bundle }, WorkingDirectory = bundleDirectory, Description = "打包模拟 " + bundle };
            if (repositoryRoot != null)
            {
                var entry = Path.Combine(repositoryRoot, "src", "native-host", "sim-host.ts");
                if (File.Exists(entry) && Directory.Exists(Path.Combine(repositoryRoot, "node_modules", "tsx")))
                    return new HostLaunch { Node = node, Arguments = { "--import", "tsx", entry }, WorkingDirectory = repositoryRoot, Description = "仓库源码模拟 " + entry };
            }
            return null;
        }

        public SimClient Start() => SimClient.Start(Node, Arguments, WorkingDirectory);
    }
}
