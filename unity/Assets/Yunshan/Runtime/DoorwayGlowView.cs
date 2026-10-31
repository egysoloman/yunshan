using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using Yunshan.Core;
using Yunshan.Core.Host;

namespace Yunshan.Runtime
{
    /// <summary>Lit doorways of open markets after dusk (Core/DoorwayGlow, as on the web):
    /// a pool of additive quads just inside each entrance, shown while the shop is open.</summary>
    public sealed class DoorwayGlowView
    {
        readonly List<(Building Building, DoorwayGlowPanel Panel)> panels = new List<(Building, DoorwayGlowPanel)>();
        readonly List<MeshRenderer> pool = new List<MeshRenderer>();
        readonly MaterialPropertyBlock block = new MaterialPropertyBlock();
        static readonly Color Warm = new Color(1f, .604f, .267f);

        public DoorwayGlowView(Transform parent, WorldDefinition world)
        {
            foreach (var b in world.Buildings) { var p = DoorwayGlow.Panel(b); if (p != null) panels.Add((b, p)); }
            var shader = Shader.Find("Yunshan/AdditiveGlow"); var material = new Material(shader != null ? shader : Shader.Find("Standard")) { name = "门内灯光" };
            for (int i = 0; i < DoorwayGlow.Limit; i++)
            {
                var quad = GameObject.CreatePrimitive(PrimitiveType.Quad); quad.name = "营业中的门内灯光"; Object.Destroy(quad.GetComponent<Collider>());
                quad.transform.SetParent(parent, false); var r = quad.GetComponent<MeshRenderer>(); r.sharedMaterial = material; r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off; r.receiveShadows = false;
                quad.SetActive(false); pool.Add(r);
            }
        }

        public int Lit { get; private set; }

        public void Update(SimFrame frame, Vector3 camera, double daylight)
        {
            int count = 0; var cam = Space.ToGame(camera);
            if (frame != null && daylight < .55) foreach (var (b, p) in panels)
            {
                if (count >= pool.Count) break;
                double dx = p.X - cam.X, dz = p.Z - cam.Z; if (dx * dx + dz * dz > DoorwayGlow.Range * DoorwayGlow.Range) continue;
                double level = DoorwayGlow.Level(frame.Shops.TryGetValue(b.Id, out var shop) && shop.Open, daylight); if (level <= 0) continue;
                var r = pool[count++]; r.gameObject.SetActive(true);
                // The game panel faces +Z rotated by its yaw; a Unity quad faces −Z, so it turns half round.
                r.transform.SetPositionAndRotation(Space.ToUnity(p.X, p.Y, p.Z), Space.Yaw(p.Yaw) * Quaternion.Euler(0, 180, 0));
                r.transform.localScale = new Vector3((float)p.Width, (float)p.Height, 1);
                block.SetColor("_Color", new Color(Warm.r, Warm.g, Warm.b, (float)(level * DoorwayGlow.Strength))); r.SetPropertyBlock(block);
            }
            for (int i = count; i < pool.Count; i++) if (pool[i].gameObject.activeSelf) pool[i].gameObject.SetActive(false);
            Lit = count;
        }
    }
}
