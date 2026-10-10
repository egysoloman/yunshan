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
        [Serializable] class PortJson { public string id; public double[] position; }
        [Serializable] class Entry { public string id; public string name; public string url; public string sha256; public int triangles; public BoundsJson boundsM; public PortJson[] ports; public string[] joints; }
        [Serializable] class Manifest { public string sourceCommit; public Entry[] assets; }
#pragma warning restore 0649

        public readonly Dictionary<string, StudioAssetBounds> Bounds = new Dictionary<string, StudioAssetBounds>();
        /// <summary>Authored sockets of character masters (manifest `ports`), game-space metres.</summary>
        public readonly Dictionary<string, Dictionary<string, double[]>> Ports = new Dictionary<string, Dictionary<string, double[]>>();
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
            foreach (var entry in manifest.assets)
            {
                Bounds[entry.id] = new StudioAssetBounds(entry.id, entry.boundsM.min, entry.boundsM.max);
                var ports = new Dictionary<string, double[]>(); foreach (var port in entry.ports ?? new PortJson[0]) ports[port.id] = port.position; Ports[entry.id] = ports;
            }
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
        /// <summary>The hidden template of a loaded asset (for assembling characters), or null.</summary>
        public GameObject Template(string id) => templates.TryGetValue(id, out var t) ? t : null;

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
        /// Pitch is about the model's local X after yaw (game rotY(yaw)·rotX(pitch));
        /// the X mirror leaves a rotation about X unchanged.
        public GameObject Place(string id, Transform parent, Vec3 gameOrigin, double gameYaw, double scale, double gamePitch = 0)
        {
            if (!templates.TryGetValue(id, out var template)) return null;
            var copy = UnityEngine.Object.Instantiate(template, parent);
            copy.transform.SetPositionAndRotation(Space.ToUnity(gameOrigin), Space.Yaw(gameYaw) * Quaternion.Euler((float)(gamePitch * Mathf.Rad2Deg), 0, 0));
            copy.transform.localScale = Vector3.one * (float)scale;
            return copy;
        }
    }
}
