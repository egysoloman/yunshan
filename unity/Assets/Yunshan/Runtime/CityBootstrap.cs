using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using UnityEngine;
using Yunshan.Core;

namespace Yunshan.Runtime
{
    /// <summary>Builds the playable city from Yunshan.Core: terrain, network,
    /// water, buildings (near detail by distance), studio models and a
    /// first-person walker. Starts automatically in any scene.</summary>
    public sealed class CityBootstrap : MonoBehaviour
    {
        public float NearBuildingRadius = 140f;
        public int NearBuildingLimit = 14;
        public float DayLengthSeconds = 1440f;
        public float StartHour = 10f;

        WorldDefinition world;
        Material solidMaterial, glassMaterial, waterMaterial;
        StudioAssets studio;
        FirstPersonController walker;
        Light sun;
        string status = "正在生成云山巨城……";
        float hour;
        readonly Dictionary<string, GameObject> far = new Dictionary<string, GameObject>();
        readonly Dictionary<string, GameObject> near = new Dictionary<string, GameObject>();
        List<StudioStaticPlacement> stations = new List<StudioStaticPlacement>();

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void AutoStart()
        {
            if (FindAnyObjectByType<CityBootstrap>() != null) return;
            new GameObject("云山巨城").AddComponent<CityBootstrap>();
        }

        async void Start()
        {
            hour = StartHour;
            try
            {
                CreateMaterials(); CreateSunAndSky();
                var camera = Camera.main != null ? Camera.main : new GameObject("Main Camera", typeof(Camera)) { tag = "MainCamera" }.GetComponent<Camera>();
                camera.farClipPlane = 6000; camera.nearClipPlane = .1f;

                status = "生成城市（与网页版逐字节一致的确定性生成）……";
                world = await Task.Run(() => World.CreateWorld());

                status = "采样地形……";
                int min = (int)Math.Floor(-world.Size / 2 / CityGeometry.TerrainChunk), max = (int)Math.Ceiling(world.Size / 2 / CityGeometry.TerrainChunk) - 1;
                var chunks = await Task.Run(() =>
                {
                    var list = new List<CityGeometry.TerrainChunkData>();
                    for (int cz = min; cz <= max; cz++) for (int cx = min; cx <= max; cx++) list.Add(CityGeometry.SampleTerrain(world, cx, cz));
                    return list;
                });
                var terrainRoot = new GameObject("地形").transform; terrainRoot.SetParent(transform, false);
                foreach (var chunk in chunks) Show(terrainRoot, CityGeometry.TerrainMesh(chunk), solidMaterial);

                status = "路网与水系……";
                Show(transform, CityGeometry.NetworkMesh(world), solidMaterial);
                Show(transform, CityGeometry.WaterMesh(world), waterMaterial);

                status = "加载体素工坊资产……";
                studio = new StudioAssets(transform);
                await studio.LoadAsync();

                status = "楼宇远景……";
                var farRoot = new GameObject("楼宇远景").transform; farRoot.SetParent(transform, false);
                foreach (var b in world.Buildings) far[b.Id] = Show(farRoot, CityGeometry.FarBuildingMesh(b), solidMaterial);

                var stationRoot = new GameObject("站台与候车棚").transform; stationRoot.SetParent(transform, false);
                stations = StudioPropLayout.StationPlacements(world, studio.Bounds);
                foreach (var s in stations) studio.Place(s.Asset, stationRoot, s.Position, s.Yaw, 1);

                walker = camera.gameObject.AddComponent<FirstPersonController>();
                walker.Initialise(world, world.Spawn, camera);
                status = null;
                StartCoroutine(NearDetailLoop());
            }
            catch (Exception error)
            {
                status = "启动失败：" + error.Message;
                Debug.LogException(error);
            }
        }

        void CreateMaterials()
        {
            var vertexColor = Shader.Find("Yunshan/VertexColorLit");
            if (vertexColor == null) vertexColor = Shader.Find("Standard");
            solidMaterial = new Material(vertexColor) { name = "云山 · 顶点色" };
            glassMaterial = new Material(vertexColor) { name = "云山 · 玻璃" };
            glassMaterial.SetFloat("_Glossiness", .8f);
            waterMaterial = new Material(Shader.Find("Standard")) { name = "云山 · 水", color = Space.Hex("#4f8d93") };
            waterMaterial.SetFloat("_Glossiness", .92f);
        }

        void CreateSunAndSky()
        {
            sun = FindAnyObjectByType<Light>();
            if (sun == null || sun.type != LightType.Directional) sun = new GameObject("太阳", typeof(Light)).GetComponent<Light>();
            sun.type = LightType.Directional; sun.shadows = LightShadows.Soft; QualitySettings.shadowDistance = 220;
            RenderSettings.fog = true; RenderSettings.fogMode = FogMode.ExponentialSquared; RenderSettings.fogDensity = .0007f;
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Trilight;
        }

        GameObject Show(Transform parent, Mesh mesh, Material material)
        {
            var go = new GameObject(mesh.name, typeof(MeshFilter), typeof(MeshRenderer));
            go.transform.SetParent(parent, false);
            go.GetComponent<MeshFilter>().sharedMesh = mesh;
            go.GetComponent<MeshRenderer>().sharedMaterial = material;
            return go;
        }

        /// <summary>Nearest buildings get walkable detail and studio models; their
        /// distant envelope is hidden while the detail is resident.</summary>
        IEnumerator NearDetailLoop()
        {
            var wait = new WaitForSeconds(.5f);
            while (true)
            {
                var feet = walker.Feet;
                var wanted = world.Buildings
                    .Select(b => (b, d: Math.Sqrt((b.Position.X - feet.X) * (b.Position.X - feet.X) + (b.Position.Z - feet.Z) * (b.Position.Z - feet.Z)) - Math.Max(b.Width, b.Depth) / 2))
                    .Where(x => x.d < NearBuildingRadius).OrderBy(x => x.d).Take(NearBuildingLimit).Select(x => x.b).ToList();
                var wantedIds = new HashSet<string>(wanted.Select(b => b.Id));
                foreach (var id in near.Keys.Where(id => !wantedIds.Contains(id)).ToList()) { Destroy(near[id]); near.Remove(id); far[id].SetActive(true); }
                foreach (var b in wanted)
                {
                    if (near.ContainsKey(b.Id)) continue;
                    near[b.Id] = BuildNear(b); far[b.Id].SetActive(false);
                    yield return null; // spread construction over frames
                }
                yield return wait;
            }
        }

        GameObject BuildNear(Building b)
        {
            var root = new GameObject(b.Name + " · 近景").transform; root.SetParent(transform, false);
            var meshes = CityGeometry.NearBuilding(b, studio.Bounds);
            Show(root, meshes.Solid, solidMaterial);
            if (meshes.Glass != null) Show(root, meshes.Glass, glassMaterial);
            foreach (var p in StudioPropLayout.BuildingPlacements(b, studio.Bounds))
                studio.Place(p.Asset, root, ArchitectureFloorPlan.BuildingWorldPosition(b, p.Local), b.Rotation, p.Scale);
            return root.gameObject;
        }

        void Update()
        {
            if (sun == null) return;
            hour = (hour + Time.deltaTime * 24f / DayLengthSeconds) % 24f;
            float angle = (hour - 6f) / 24f * 360f;
            sun.transform.rotation = Quaternion.Euler(angle, 30f, 0);
            float daylight = Mathf.Clamp01(Mathf.Sin(angle * Mathf.Deg2Rad) * 2.2f + .2f);
            sun.intensity = Mathf.Lerp(.05f, 1.15f, daylight);
            sun.color = Color.Lerp(new Color(.55f, .62f, .9f), new Color(1f, .95f, .86f), daylight);
            RenderSettings.ambientSkyColor = Color.Lerp(new Color(.08f, .1f, .16f), new Color(.62f, .72f, .82f), daylight);
            RenderSettings.ambientEquatorColor = Color.Lerp(new Color(.06f, .07f, .1f), new Color(.55f, .6f, .58f), daylight);
            RenderSettings.ambientGroundColor = Color.Lerp(new Color(.03f, .03f, .04f), new Color(.35f, .33f, .28f), daylight);
            RenderSettings.fogColor = Color.Lerp(new Color(.1f, .12f, .17f), new Color(.78f, .83f, .84f), daylight);
            if (Camera.main != null) { Camera.main.clearFlags = CameraClearFlags.SolidColor; Camera.main.backgroundColor = RenderSettings.fogColor; }
        }

        void OnGUI()
        {
            var style = new GUIStyle(GUI.skin.label) { fontSize = 16 };
            if (status != null) { GUI.Label(new UnityEngine.Rect(24, 24, 900, 40), status, style); return; }
            int h = Mathf.FloorToInt(hour), m = Mathf.FloorToInt((hour - h) * 60);
            var feet = walker != null ? walker.Feet : null;
            GUI.Label(new UnityEngine.Rect(24, 20, 900, 30), $"云山巨城 · {h:00}:{m:00}  ·  近景楼宇 {near.Count}  ·  资产 {studio?.Loaded.Count ?? 0} 件已加载" + (studio != null && studio.Failed.Count > 0 ? $"，{studio.Failed.Count} 件失败" : ""), style);
            if (feet != null) GUI.Label(new UnityEngine.Rect(24, 46, 900, 30), $"位置 {feet.X:0.0} / {feet.Y:0.0} / {feet.Z:0.0}  ·  点击锁定鼠标，WASD 行走，Shift 冲刺，Esc 释放鼠标", style);
        }
    }
}
