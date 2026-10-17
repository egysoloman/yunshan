using System.IO;
using UnityEditor;
using UnityEngine;

namespace Yunshan.Editor
{
    /// <summary>Copies the repository's studio GLBs and manifest into
    /// StreamingAssets so player builds can load them (the Editor reads the
    /// repository directly and does not need this).</summary>
    public static class StudioAssetSync
    {
        [MenuItem("云山/复制体素工坊资产到 StreamingAssets")]
        public static void Sync()
        {
            var repository = Path.GetFullPath(Path.Combine(Application.dataPath, "..", ".."));
            var source = Path.Combine(repository, "public", "studio-assets");
            var manifest = Path.Combine(repository, "src", "rendering", "studio-assets.json");
            var target = Path.Combine(Application.streamingAssetsPath, "studio-assets");
            if (!Directory.Exists(source) || !File.Exists(manifest)) { Debug.LogError($"云山：未找到 {source} 或 {manifest}"); return; }
            Directory.CreateDirectory(target);
            int count = 0;
            foreach (var file in Directory.GetFiles(source, "*.glb")) { File.Copy(file, Path.Combine(target, Path.GetFileName(file)), true); count++; }
            File.Copy(manifest, Path.Combine(target, "studio-assets.json"), true);
            AssetDatabase.Refresh();
            Debug.Log($"云山：已复制 {count} 个 glb 与清单到 {target}");
        }
    }
}
