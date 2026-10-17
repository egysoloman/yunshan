using System.Collections.Generic;
using UnityEngine;

namespace Yunshan.Runtime
{
    /// <summary>The studio sky masters (web sky-models.ts) in Unity: ENV-110 dome
    /// with the web gradient, ENV-112 sun and ENV-113 moon at 3.6× the light
    /// vector (as the web orbs), ENV-114 star field fading with the night. They
    /// are far beyond the 6km city far plane, so a sky camera with a 30km far
    /// plane draws them first on their own layer, and the city camera then only
    /// clears depth. Display only.</summary>
    public sealed class StudioSky
    {
        const int SkyLayer = 31;
        readonly Camera city, sky;
        readonly Transform root, sun, moon, stars;
        readonly Material dome;
        readonly List<Material> starMaterials = new List<Material>();
        public bool Active => sky != null;

        public StudioSky(StudioAssets studio, Camera city)
        {
            this.city = city;
            var domeShader = Shader.Find("Yunshan/SkyDome"); var bodyShader = Shader.Find("Yunshan/SkyBody");
            if (studio == null || domeShader == null || bodyShader == null || !studio.Has("ENV-110")) return;
            root = new GameObject("体素工坊 · 天空（天空相机）").transform;
            dome = new Material(domeShader) { name = "云山 · 天空穹顶" };
            Transform Make(string id, Material shared, List<Material> collect)
            {
                var template = studio.Template(id); if (template == null) return null;
                var copy = Object.Instantiate(template, root, false); copy.SetActive(true);
                foreach (var t in copy.GetComponentsInChildren<Transform>(true)) t.gameObject.layer = SkyLayer;
                foreach (var renderer in copy.GetComponentsInChildren<Renderer>(true))
                {
                    var materials = renderer.sharedMaterials;
                    for (int i = 0; i < materials.Length; i++)
                    {
                        if (shared != null) { materials[i] = shared; continue; }
                        var body = new Material(bodyShader) { name = id + " · 天体" }; var source = materials[i];
                        if (source != null)
                        {
                            foreach (var p in new[] { "baseColorTexture", "_MainTex", "_BaseMap" }) if (source.HasProperty(p) && source.GetTexture(p) != null) { body.mainTexture = source.GetTexture(p); break; }
                            foreach (var p in new[] { "baseColorFactor", "_Color", "_BaseColor" }) if (source.HasProperty(p)) { body.color = source.GetColor(p); break; }
                        }
                        materials[i] = body; collect?.Add(body);
                    }
                    renderer.sharedMaterials = materials; renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off; renderer.receiveShadows = false;
                }
                // Centre each model on its own bounds (the web centred() helper).
                var bounds = new Bounds(); bool first = true;
                foreach (var r in copy.GetComponentsInChildren<Renderer>(true)) { if (first) { bounds = r.bounds; first = false; } else bounds.Encapsulate(r.bounds); }
                var holder = new GameObject(id).transform; holder.SetParent(root, false); holder.gameObject.layer = SkyLayer;
                copy.transform.SetParent(holder, true); copy.transform.position -= bounds.center;
                return holder;
            }
            Make("ENV-110", dome, null);
            sun = Make("ENV-112", null, null); moon = Make("ENV-113", null, null); stars = Make("ENV-114", null, starMaterials);
            sky = new GameObject("天空相机").AddComponent<Camera>();
            sky.transform.SetParent(city.transform, false);
            sky.cullingMask = 1 << SkyLayer; sky.clearFlags = CameraClearFlags.SolidColor; sky.nearClipPlane = 1; sky.farClipPlane = 30000; sky.depth = city.depth - 1;
            city.cullingMask &= ~(1 << SkyLayer); city.clearFlags = CameraClearFlags.Depth;
        }

        /// <summary>sunUnity: the light vector already mirrored to Unity (CityBootstrap.UpdateSky's sunGame).</summary>
        public void Update(Vector3 sunUnity, float altitude, float daylight, float twilight, Color background)
        {
            if (sky == null) return;
            sky.fieldOfView = city.fieldOfView; sky.backgroundColor = background; city.clearFlags = CameraClearFlags.Depth;
            var eye = city.transform.position; root.position = eye;
            var horizon = Color.Lerp(Color.Lerp(new Color32(0x20, 0x3b, 0x4c, 255), new Color32(0xbd, 0xd7, 0xdd, 255), daylight), new Color32(0xe2, 0xaf, 0x86, 255), twilight * .35f);
            dome.SetColor("_Horizon", horizon); dome.SetColor("_Top", Color.Lerp(new Color32(0x07, 0x18, 0x22, 255), new Color32(0x41, 0x8d, 0xaf, 255), daylight));
            if (sun != null) { sun.position = eye + sunUnity * 3.6f; sun.gameObject.SetActive(altitude > -.08f); }
            if (moon != null) { moon.position = eye - sunUnity * 3.6f; moon.gameObject.SetActive(altitude < .08f); }
            if (stars != null) { float opacity = (1 - daylight) * .8f; stars.gameObject.SetActive(opacity > .01f); foreach (var m in starMaterials) m.SetFloat("_Opacity", opacity); }
        }
    }
}
