using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using UnityEngine;
using Yunshan.Core;

namespace Yunshan.Runtime
{
    /// <summary>The voxel-studio manifest (src/rendering/studio-assets.json) and
    /// one hidden template per GLB, cloned for each placement.</summary>
    public sealed class StudioAssets
    {
#pragma warning disable 0649 // assigned by JsonUtility
        [Serializable] class BoundsJson { public double[] min; public double[] max; }
        [Serializable] class Entry { public string id; public string name; public string url; public string sha256; public int triangles; public BoundsJson boundsM; }
        [Serializable] class Manifest { public string sourceCommit; public Entry[] assets; }
#pragma warning restore 0649

        public readonly Dictionary<string, StudioAssetBounds> Bounds = new Dictionary<string, StudioAssetBounds>();
        readonly Dictionary<string, GameObject> templates = new Dictionary<string, GameObject>();
        readonly Transform templateRoot;
        string directory;
        public readonly List<string> Loaded = new List<string>(), Failed = new List<string>();

        public StudioAssets(Transform parent)
        {
            templateRoot = new GameObject("体素工坊模板（隐藏）").transform;
            templateRoot.SetParent(parent, false);
            templateRoot.gameObject.SetActive(false);
        }

        /// <summary>StreamingAssets/studio-assets in builds; in the Editor the
        /// repository's own public/studio-assets is read directly.</summary>
        public static string ResolveDirectory()
        {
            var streaming = Path.Combine(Application.streamingAssetsPath, "studio-assets");
            if (File.Exists(Path.Combine(streaming, "studio-assets.json"))) return streaming;
#if UNITY_EDITOR
            var repository = Path.GetFullPath(Path.Combine(Application.dataPath, "..", ".."));
            var published = Path.Combine(repository, "public", "studio-assets");
            if (Directory.Exists(published)) return published;
#endif
            return null;
        }

        static string ManifestPath(string directory)
        {
            var local = Path.Combine(directory, "studio-assets.json");
            if (File.Exists(local)) return local;
#if UNITY_EDITOR
            var repository = Path.GetFullPath(Path.Combine(Application.dataPath, "..", ".."));
            var source = Path.Combine(repository, "src", "rendering", "studio-assets.json");
            if (File.Exists(source)) return source;
#endif
            return null;
        }

        public async Task LoadAsync()
        {
            directory = ResolveDirectory();
            var manifestPath = directory == null ? null : ManifestPath(directory);
            if (manifestPath == null) { Debug.LogWarning("云山：未找到体素工坊资产清单，场景使用程序几何。"); return; }
            var manifest = JsonUtility.FromJson<Manifest>(File.ReadAllText(manifestPath));
            foreach (var entry in manifest.assets) Bounds[entry.id] = new StudioAssetBounds(entry.id, entry.boundsM.min, entry.boundsM.max);
            foreach (var entry in manifest.assets)
            {
                var file = Path.Combine(directory, Path.GetFileName(entry.url));
                try
                {
                    var gltf = new GLTFast.GltfImport();
                    if (!await gltf.Load(new Uri(file).AbsoluteUri)) throw new InvalidOperationException("glTF load failed");
                    var template = new GameObject($"{entry.id} {entry.name}");
                    template.transform.SetParent(templateRoot, false);
                    if (!await gltf.InstantiateMainSceneAsync(template.transform)) throw new InvalidOperationException("glTF instantiate failed");
                    templates[entry.id] = template; Loaded.Add(entry.id); CollectEmission(template);
                }
                catch (Exception error) { Failed.Add(entry.id); Debug.LogWarning($"云山：{entry.id} 加载失败，保留程序几何：{error.Message}"); }
            }
        }

        public bool Has(string id) => templates.ContainsKey(id);

        // Authored emission per template material (copies share these materials).
        readonly List<(Material material, string property, Color authored)> emissive = new List<(Material, string, Color)>();
        float lastFactor = -1;

        void CollectEmission(GameObject template)
        {
            foreach (var renderer in template.GetComponentsInChildren<Renderer>(true))
                foreach (var material in renderer.sharedMaterials)
                {
                    if (material == null) continue;
                    foreach (var property in new[] { "emissiveFactor", "_EmissionColor" })
                        if (material.HasProperty(property)) { var color = material.GetColor(property); if (color.maxColorComponent > 0) emissive.Add((material, property, color)); break; }
                }
        }

        /// <summary>Studio lamps glow only with city power, more at night:
        /// power × (0.35 + 0.65 × (1 − daylight)), as the web asset pool.</summary>
        public void SetLighting(float daylight, float power)
        {
            float factor = Mathf.Clamp01(power) * (.35f + .65f * (1 - Mathf.Clamp01(daylight)));
            if (Mathf.Abs(factor - lastFactor) < .005f) return;
            lastFactor = factor;
            foreach (var (material, property, authored) in emissive) material.SetColor(property, authored * factor);
        }

        /// <summary>Instantiates at a game-space origin with game yaw and uniform scale.</summary>
        public GameObject Place(string id, Transform parent, Vec3 gameOrigin, double gameYaw, double scale)
        {
            if (!templates.TryGetValue(id, out var template)) return null;
            var copy = UnityEngine.Object.Instantiate(template, parent);
            copy.transform.SetPositionAndRotation(Space.ToUnity(gameOrigin), Space.Yaw(gameYaw));
            copy.transform.localScale = Vector3.one * (float)scale;
            return copy;
        }
    }
}
