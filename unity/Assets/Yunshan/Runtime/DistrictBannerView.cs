using UnityEngine;
using Yunshan.Core;

namespace Yunshan.Runtime
{
    /// <summary>District-name hangings (Core/DistrictBanners, as on the web): a red cloth quad bracketed in
    /// front of an entrance facade with the name printed top to bottom on both faces. Static; built once.</summary>
    public sealed class DistrictBannerView
    {
        public int Count { get; }

        public DistrictBannerView(Transform parent, WorldDefinition world, Font font)
        {
            var root = new GameObject("城区竖幅").transform; root.SetParent(parent, false);
            var shader = Shader.Find("Yunshan/InstancedColor"); if (shader == null) shader = Shader.Find("Standard");
            var cloth = new Material(shader) { name = "城区竖幅" }; cloth.SetColor("_Color", Space.Hex("#8e2a22"));
            foreach (var banner in DistrictBanners.Of(world))
            {
                var at = Space.ToUnity(banner.X, banner.Y, banner.Z); var facing = Space.Yaw(banner.Yaw);
                var quad = GameObject.CreatePrimitive(PrimitiveType.Quad); quad.name = "城区竖幅 · " + banner.DistrictId; Object.Destroy(quad.GetComponent<Collider>());
                quad.transform.SetParent(root, false); quad.transform.SetPositionAndRotation(at, facing * Quaternion.Euler(0, 180, 0));
                quad.transform.localScale = new Vector3((float)DistrictBanners.Width, (float)DistrictBanners.Height, 1);
                quad.GetComponent<MeshRenderer>().sharedMaterial = cloth;
                // The game banner faces +Z rotated by its yaw; one print on each side, a centimetre off the cloth.
                foreach (var side in new[] { 1f, -1f })
                {
                    var label = new GameObject("竖幅文字", typeof(TextMesh)); label.transform.SetParent(root, false);
                    var normal = facing * Vector3.forward * side;
                    label.transform.SetPositionAndRotation(at + normal * .01f, facing * Quaternion.Euler(0, side > 0 ? 180 : 0, 0));
                    var t = label.GetComponent<TextMesh>(); t.anchor = TextAnchor.MiddleCenter; t.alignment = TextAlignment.Center; t.fontSize = 64; t.characterSize = .05f; t.color = Space.Hex("#f3dfb0");
                    t.text = string.Join("\n", Elements(banner.Text));
                    if (font != null) { t.font = font; label.GetComponent<MeshRenderer>().sharedMaterial = font.material; }
                    var size = label.GetComponent<MeshRenderer>().bounds.size; float s = Mathf.Min(1.1f / Mathf.Max(size.x, 1e-3f), 5.2f / Mathf.Max(size.y, 1e-3f));
                    label.transform.localScale = new Vector3(s, s, s);
                }
                Count++;
            }
        }

        static string[] Elements(string text) { var e = System.Globalization.StringInfo.GetTextElementEnumerator(text); var list = new System.Collections.Generic.List<string>(); while (e.MoveNext()) list.Add(e.GetTextElement()); return list.ToArray(); }
    }
}
