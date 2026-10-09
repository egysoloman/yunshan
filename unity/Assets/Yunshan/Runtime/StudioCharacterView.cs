using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using Yunshan.Core;
using Yunshan.Core.Host;

namespace Yunshan.Runtime
{
    /// <summary>Residents near the camera as studio characters on the studio
    /// skeleton, as the web StudioCharacterPool: the shared rules in
    /// Core/StudioCharacterLook.cs (parity with studio-character-look.ts) pick
    /// the masters; the skeleton's rest pose is the body's own joint ports;
    /// garments re-point their SkinnedMeshRenderer bones to it by name; the
    /// unskinned body gets one bone weight per vertex (BodyJoint); heads, hair,
    /// hats, hands, feet and held items ride their joints. Positions, yaw and
    /// walk phase come from CityLifeView, which leaves these residents out.
    /// Game space is mirrored on X (Space.ToUnity), as glTFast's templates are.</summary>
    public sealed class StudioCharacterView
    {
        // Same as STUDIO_CHARACTER_RANGE.balanced on the web.
        public float Range = 45; public int Count = 20; public int BuildsPerFrame = 2;
        sealed class Character { public string Key; public Transform Holder; public Dictionary<string, Transform> Bones; }
        readonly StudioAssets studio;
        readonly Transform root;
        readonly Dictionary<string, Character> characters = new Dictionary<string, Character>();
        readonly Dictionary<string, Mesh> bodyMeshes = new Dictionary<string, Mesh>();
        public int Drawn => characters.Count;

        public StudioCharacterView(StudioAssets studio, Transform parent)
        {
            this.studio = studio;
            root = new GameObject("体素工坊 · 骨骼人物").transform; root.SetParent(parent, false);
        }

        static Vector3 Mirror(double x, double y, double z) => new Vector3(-(float)x, (float)y, (float)z);

        public void Update(SimFrame frame, CityLifeView life, Vec3 camera)
        {
            if (frame == null || life == null || !studio.Has(StudioCharacterLook.Assets[0])) return;
            var near = new List<(SimFrame.Citizen C, Vec3 P, double Yaw, double Phase, double D)>();
            foreach (var c in frame.Citizens)
            {
                if (!life.TryMotion(c.Id, out var p, out var yaw, out var phase)) continue;
                double d = System.Math.Sqrt((p.X - camera.X) * (p.X - camera.X) + (p.Y - camera.Y) * (p.Y - camera.Y) + (p.Z - camera.Z) * (p.Z - camera.Z));
                if (d <= Range) near.Add((c, p, yaw, phase, d));
            }
            near = near.OrderBy(e => e.D).ThenBy(e => e.C.Id, System.StringComparer.Ordinal).Take(Count).ToList();
            var next = new HashSet<string>(); int built = 0;
            foreach (var e in near)
            {
                var c = e.C;
                var look = StudioCharacterLook.Look(c.Id, new CharacterContext { Age = c.Age, Role = c.Role ?? "", State = c.State ?? "", Hour = frame.Hour, Weather = frame.Weather ?? "", Health = c.Health, Pregnant = c.Pregnant, Ceremony = c.Ceremony, InfantNearby = c.InfantNearby });
                string key = look.Rig + "|" + look.Body + "|" + string.Join("|", look.Parts.Select(p => p.Asset + "@" + p.Mount));
                characters.TryGetValue(c.Id, out var character);
                if (character == null || character.Key != key)
                {
                    if (character == null && built >= BuildsPerFrame) continue;
                    if (character != null) Release(c.Id);
                    character = Build(look, key); if (character == null) continue;
                    built++; characters[c.Id] = character;
                }
                next.Add(c.Id);
                bool dead = !c.Alive, seated = c.Seated, walking = c.State == "moving" && !seated && !dead;
                var pose = StudioCharacterLook.Pose(e.Phase, walking, seated, dead);
                foreach (var joint in StudioCharacterLook.Joints)
                {
                    // Mirroring on X keeps a turn about X and negates a turn about Z.
                    pose.TryGetValue(joint, out var r);
                    character.Bones[joint].localRotation = Quaternion.Euler((float)(r.X * Mathf.Rad2Deg), 0, -(float)(r.Z * Mathf.Rad2Deg));
                }
                // The studio models face −Z; the game faces +Z at yaw 0.
                character.Holder.SetPositionAndRotation(Space.ToUnity(e.P), Space.Yaw(e.Yaw + System.Math.PI));
            }
            foreach (var id in characters.Keys.Where(id => !next.Contains(id)).ToList()) Release(id);
            life.Modelled = next;
        }

        Character Build(CharacterLook look, string key)
        {
            var bodyTemplate = studio.Template(look.Body); if (bodyTemplate == null || !studio.Ports.TryGetValue(look.Body, out var bodyPorts)) return null;
            var rest = StudioCharacterLook.Rest(bodyPorts);
            var holder = new GameObject("居民 · " + look.Body).transform; holder.SetParent(root, false);
            var bones = new Dictionary<string, Transform>();
            foreach (var joint in StudioCharacterLook.Joints)
            {
                var bone = new GameObject(joint).transform; var parent = StudioCharacterLook.Parent[joint];
                bone.SetParent(parent != null ? bones[parent] : holder, false);
                var p = rest[joint]; var q = parent != null ? rest[parent] : new double[] { 0, 0, 0 };
                bone.localPosition = Mirror(p[0] - q[0], p[1] - q[1], p[2] - q[2]); bones[joint] = bone;
            }
            var boneArray = StudioCharacterLook.Joints.Select(j => bones[j]).ToArray();
            // The body: rigid bone weights from its own ports, cached per master.
            foreach (var filter in bodyTemplate.GetComponentsInChildren<MeshFilter>(true))
            {
                var renderer = filter.GetComponent<MeshRenderer>(); if (renderer == null || filter.sharedMesh == null) continue;
                string cacheKey = look.Body + ":" + filter.name;
                if (!bodyMeshes.TryGetValue(cacheKey, out var mesh))
                {
                    var toTemplate = bodyTemplate.transform.worldToLocalMatrix * filter.transform.localToWorldMatrix;
                    mesh = Object.Instantiate(filter.sharedMesh); mesh.name = look.Body + " · 骨骼蒙皮";
                    var vertices = mesh.vertices; var weights = new BoneWeight[vertices.Length];
                    for (int i = 0; i < vertices.Length; i++)
                    {
                        var v = toTemplate.MultiplyPoint3x4(vertices[i]); vertices[i] = v;
                        weights[i] = new BoneWeight { boneIndex0 = System.Array.IndexOf(StudioCharacterLook.Joints, StudioCharacterLook.BodyJoint(-v.x, v.y, bodyPorts)), weight0 = 1 };
                    }
                    mesh.vertices = vertices; mesh.boneWeights = weights;
                    // Bind poses at the rest skeleton, relative to the holder (where the renderer sits).
                    mesh.bindposes = boneArray.Select(b => b.worldToLocalMatrix * holder.localToWorldMatrix).ToArray();
                    mesh.RecalculateBounds(); bodyMeshes[cacheKey] = mesh;
                }
                var skin = new GameObject(look.Body).AddComponent<SkinnedMeshRenderer>(); skin.transform.SetParent(holder, false);
                skin.sharedMesh = mesh; skin.bones = boneArray; skin.rootBone = bones["root"]; skin.sharedMaterials = renderer.sharedMaterials; skin.updateWhenOffscreen = true;
            }
            foreach (var part in look.Parts)
            {
                var template = studio.Template(part.Asset); if (template == null) continue;
                if (part.Mount == "skin")
                {
                    var worn = Object.Instantiate(template, holder, false); worn.SetActive(true); worn.transform.localPosition = Vector3.zero; worn.transform.localRotation = Quaternion.identity;
                    foreach (var smr in worn.GetComponentsInChildren<SkinnedMeshRenderer>(true))
                    {
                        smr.bones = smr.bones.Select(b => b != null && bones.TryGetValue(StudioCharacterLook.GarmentJoint(b.name), out var mapped) ? mapped : bones["root"]).ToArray();
                        smr.rootBone = bones["root"]; smr.updateWhenOffscreen = true;
                    }
                    continue;
                }
                studio.Ports.TryGetValue(part.Asset, out var partPorts); var bounds = studio.Bounds[part.Asset];
                var (joint, offset) = StudioCharacterLook.MountOffset(part.Mount, rest, bodyPorts, partPorts ?? new Dictionary<string, double[]>(), bounds.Min, bounds.Max);
                var rigid = Object.Instantiate(template, bones[joint], false); rigid.SetActive(true);
                rigid.transform.localPosition = Mirror(offset[0], offset[1], offset[2]); rigid.transform.localRotation = Quaternion.identity;
            }
            return new Character { Key = key, Holder = holder, Bones = bones };
        }

        void Release(string id)
        {
            if (!characters.TryGetValue(id, out var character)) return;
            Object.Destroy(character.Holder.gameObject); characters.Remove(id);
        }
    }
}
