using System.Collections.Generic;
using UnityEngine;
using Yunshan.Core;

namespace Yunshan.Runtime
{
    /// <summary>District names over the city in flight (Core/DistrictTags, as on the web): an undyed cloth quad
    /// with the name printed top to bottom, turned to the camera and scaled with distance so it keeps one screen size.</summary>
    public sealed class DistrictTagView
    {
        readonly List<(DistrictTag Tag, Transform Root)> tags = new List<(DistrictTag, Transform)>();

        public DistrictTagView(Transform parent, WorldDefinition world, Font font)
        {
            var shader = Shader.Find("Yunshan/InstancedColor"); if (shader == null) shader = Shader.Find("Standard");
            var cloth = new Material(shader) { name = "城区空中名牌" }; cloth.SetColor("_Color", Space.Hex("#e9dfc6"));
            foreach (var tag in DistrictTags.Of(world))
            {
                // A unit-tall tag standing on its anchor; the root is scaled to the wanted height each frame.
                var root = new GameObject("城区空中名牌 · " + tag.DistrictId).transform; root.SetParent(parent, false); root.position = Space.ToUnity(tag.X, tag.Y, tag.Z);
                var quad = GameObject.CreatePrimitive(PrimitiveType.Quad); Object.Destroy(quad.GetComponent<Collider>());
                quad.transform.SetParent(root, false); quad.transform.localPosition = new Vector3(0, .5f, 0); quad.transform.localScale = new Vector3(1f / 3, 1, 1);
                var r = quad.GetComponent<MeshRenderer>(); r.sharedMaterial = cloth; r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off; r.receiveShadows = false;
                var label = new GameObject("名牌文字", typeof(TextMesh)); label.transform.SetParent(root, false); label.transform.localPosition = new Vector3(0, .5f, -.01f);
                var t = label.GetComponent<TextMesh>(); t.anchor = TextAnchor.MiddleCenter; t.alignment = TextAlignment.Center; t.fontSize = 64; t.characterSize = .05f; t.color = Space.Hex("#3a2c22");
                t.text = string.Join("\n", Elements(tag.Text));
                if (font != null) { t.font = font; label.GetComponent<MeshRenderer>().sharedMaterial = font.material; }
                var size = label.GetComponent<MeshRenderer>().bounds.size; float s = Mathf.Min(.26f / Mathf.Max(size.x, 1e-3f), .84f / Mathf.Max(size.y, 1e-3f));
                label.transform.localScale = new Vector3(s, s, s);
                root.gameObject.SetActive(false); tags.Add((tag, root));
            }
        }

        public void Update(bool flying, Camera view)
        {
            var camera = Space.ToGame(view.transform.position); float perMetre = (float)(DistrictTags.Screen * 2 * Mathf.Tan(view.fieldOfView * Mathf.Deg2Rad / 2));
            foreach (var (tag, root) in tags)
            {
                bool shown = DistrictTags.Shown(flying, tag, camera); if (root.gameObject.activeSelf != shown) root.gameObject.SetActive(shown);
                if (!shown) continue;
                // Faces the camera upright (a quad's front is −Z), one screen size at any distance.
                var away = root.position - view.transform.position; away.y = 0; if (away.sqrMagnitude > 1e-6f) root.rotation = Quaternion.LookRotation(away);
                float h = perMetre * Vector3.Distance(root.position, view.transform.position); root.localScale = new Vector3(h, h, h);
            }
        }

        static string[] Elements(string text) { var e = System.Globalization.StringInfo.GetTextElementEnumerator(text); var list = new List<string>(); while (e.MoveNext()) list.Add(e.GetTextElement()); return list.ToArray(); }
    }
}
