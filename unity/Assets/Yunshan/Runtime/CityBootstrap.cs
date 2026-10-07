using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using UnityEngine;
using Yunshan.Core;
using Yunshan.Core.Host;

namespace Yunshan.Runtime
{
    /// <summary>Builds the playable city from Yunshan.Core (terrain, network,
    /// water, buildings with near detail, studio models), starts the
    /// authoritative simulation host and plays it in first person: residents,
    /// vehicles, signals, interaction, HUD, save/load. Starts automatically.</summary>
    public sealed class CityBootstrap : MonoBehaviour
    {
        public float NearBuildingRadius = 140f;
        public int NearBuildingLimit = 14;

        WorldDefinition world;
        Material solidMaterial, glassMaterial, waterMaterial;
        StudioAssets studio;
        FirstPersonController walker;
        SimSession session;
        CityLifeView life;
        Light sun;
        Camera view;
        string status = "正在生成云山巨城……";
        readonly Dictionary<string, GameObject> far = new Dictionary<string, GameObject>();
        readonly Dictionary<string, GameObject> near = new Dictionary<string, GameObject>();
        Vector2 contextScroll;
        int contextTab;
        bool showHelp = true;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void AutoStart()
        {
            if (FindAnyObjectByType<CityBootstrap>() != null) return;
            new GameObject("云山巨城").AddComponent<CityBootstrap>();
        }

        async void Start()
        {
            try
            {
                CreateMaterials(); CreateSunAndSky();
                view = Camera.main != null ? Camera.main : new GameObject("Main Camera", typeof(Camera)) { tag = "MainCamera" }.GetComponent<Camera>();
                view.farClipPlane = 6000; view.nearClipPlane = .1f;

                // The simulation host chooses the city (a save may hold another layout).
                session = new SimSession();
                session.PlayerMovedBySimulation += OnPlayerMovedBySimulation;
                session.Start();
                status = "启动权威模拟并生成城市……";
                var defaultWorld = Task.Run(() => World.CreateWorld());
                while (session.State == SimSession.Phase.Starting) { session.Update(0, "walk", null, null, null, null); await Task.Yield(); }
                world = await defaultWorld;
                if (session.State == SimSession.Phase.Ready && (session.Layout != World.CurrentCityLayout || session.Seed != world.Seed))
                {
                    status = $"按存档重建城市布局 {session.Layout}……";
                    world = await Task.Run(() => World.CreateWorld(session.Seed, session.Layout));
                }

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
                foreach (var s in StudioPropLayout.StationPlacements(world, studio.Bounds)) studio.Place(s.Asset, stationRoot, s.Position, s.Yaw, 1);

                walker = view.gameObject.AddComponent<FirstPersonController>();
                walker.Initialise(world, view, CanAccess, () => session.Voxels);
                if (session.Frame != null) OnPlayerMovedBySimulation(session.Frame);
                life = new CityLifeView(world, transform);
                status = null;
                StartCoroutine(NearDetailLoop());
            }
            catch (Exception error)
            {
                status = "启动失败：" + error.Message;
                Debug.LogException(error);
            }
        }

        bool CanAccess(Building building, int floor)
        {
            var player = session?.Frame?.Player;
            return Access.CanAccessFloor(building, floor, player?.Role ?? "traveler", player?.Identities);
        }

        void OnPlayerMovedBySimulation(SimFrame frame)
        {
            if (walker == null || walker.Walker == null) return;
            var active = frame.AircraftList.FirstOrDefault(a => a.Active);
            walker.Passenger = frame.Player.VehicleId != null; walker.Driving = frame.Player.Driving;
            if (active != null)
            {
                if (walker.Mode != active.Kind) { walker.Walker.Mode = active.Kind; walker.Walker.Yaw = active.Yaw; walker.Walker.Pitch = active.Pitch; }
                if (active.Status == "landing") { walker.Walker.Yaw = active.Yaw; walker.Walker.Pitch = active.Pitch; }
                walker.AircraftPosition = active.Position; walker.Walker.SyncAircraft(active.Position);
                return;
            }
            walker.AircraftPosition = null;
            if (walker.Mode != "walk") { walker.Walker.SetWalk(frame.Player.Position); return; }
            if (frame.Player.VehicleId != null) { walker.Walker.SyncPassenger(frame.Player.Position); return; }
            var feet = walker.Feet; var p = frame.Player.Position;
            if (Math.Abs(feet.X - p.X) + Math.Abs(feet.Y - p.Y) + Math.Abs(feet.Z - p.Z) > .05) walker.Walker.SetWalk(p);
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

        /// <summary>Nearest buildings get walkable detail and studio models.</summary>
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
                    yield return null;
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
            if (session == null) return;
            string mode = walker != null ? walker.Mode : "walk";
            Dictionary<string, object> controls = null;
            if (walker != null)
            {
                if (mode != "walk") controls = new Dictionary<string, object> { ["aviation"] = walker.AviationControls() };
                else if (walker.Driving) controls = new Dictionary<string, object> { ["driving"] = walker.DrivingControls() };
                if (walker.Walker.BlockedAccess != null) { session.Say(walker.Walker.BlockedAccess, false); walker.Walker.BlockedAccess = null; }
            }
            var feet = walker != null ? walker.Feet : null;
            session.Update(Time.unscaledDeltaTime, mode, feet, feet, controls, walker?.Walker.Inside?.Id);
            if (walker != null && GUIUtility.keyboardControl == 0) HandleKeys();
            UpdateSky();
            if (life != null && session.Frame != null) life.Draw(session, feet);
        }

        void HandleKeys()
        {
            if (Input.GetKeyDown(KeyCode.E)) Interact();
            if (Input.GetKeyDown(KeyCode.F) && session.Frame != null) session.Command(Cmd("pause", session.Frame.Paused ? 0 : 1));
            if (Input.GetKeyDown(KeyCode.H)) showHelp = !showHelp;
            if (Input.GetKeyDown(KeyCode.T)) walker.Walker.Pitch = -.05;
            if (Input.GetKeyDown(KeyCode.V) && session.Frame != null)
            {
                var craft = session.Frame.AircraftList.FirstOrDefault(a => a.Active);
                if (craft != null) session.Command(Cmd(craft.Status == "parked" ? "leaveAircraft" : "landAircraft", target: craft.Id));
                else session.Say("航空视角需要在城市停机位租用并实际登机。", false);
            }
            if ((Input.GetKeyDown(KeyCode.B) || Input.GetKeyDown(KeyCode.X)) && walker.Mode == "walk")
            {
                var feet = walker.Feet; var d = walker.GameDirection();
                var position = new Dictionary<string, object> { ["x"] = JsMath.Round((feet.X + d.X * 1.4) / .2) * .2, ["y"] = JsMath.Round((feet.Y + .1) / .2) * .2, ["z"] = JsMath.Round((feet.Z + d.Z * 1.4) / .2) * .2 };
                var command = Cmd(Input.GetKeyDown(KeyCode.B) ? "build" : "demolish"); command["position"] = position;
                Execute(command);
            }
        }

        static Dictionary<string, object> Cmd(string type, double? value = null, string target = null)
        {
            var command = new Dictionary<string, object> { ["type"] = type };
            if (target != null) command["targetId"] = target;
            if (value != null) command["value"] = value.Value;
            return command;
        }

        /// <summary>The web App's execute(): only time controls and aircraft
        /// commands work away from walking.</summary>
        void Execute(Dictionary<string, object> command)
        {
            var type = (string)command["type"];
            bool aircraftCommand = new[] { "rentAircraft", "boardAircraft", "leaveAircraft", "landAircraft", "returnAircraft", "refuelAircraft" }.Contains(type);
            if (!new[] { "setTime", "pause", "speed" }.Contains(type) && !aircraftCommand && walker.Mode != "walk") { session.Say("请先安全落地并退出机舱，走近人物、建筑或站点后操作。", false); return; }
            session.Command(command);
        }

        /// <summary>Same order as the web App's interact() (E).</summary>
        void Interact()
        {
            var frame = session.Frame; if (frame == null) return;
            var aircraft = frame.AircraftList.FirstOrDefault(a => a.Active);
            if (aircraft != null) { Execute(Cmd(aircraft.Status == "parked" ? "leaveAircraft" : "landAircraft", target: aircraft.Id)); return; }
            if (frame.Player.VehicleId != null) { Execute(Cmd("leaveVehicle")); return; }
            var feet = walker.Feet;
            double D(Vec3 a, Vec3 b) => Math.Sqrt((a.X - b.X) * (a.X - b.X) + (a.Y - b.Y) * (a.Y - b.Y) + (a.Z - b.Z) * (a.Z - b.Z));
            var ground = frame.AircraftList.Where(a => D(feet, a.Position) < 18).OrderBy(a => D(feet, a.Position)).FirstOrDefault();
            if (ground != null && D(feet, ground.Position) <= 6)
            {
                var section = session.Context.FirstOrDefault(s => s.Kind == "aircraft" && s.Id == ground.Id);
                bool reserved = section != null && section.Actions.Any(a => a.Command != null && (string)a.Command["type"] == "returnAircraft");
                Execute(Cmd(ground.Kind == "drone" && !reserved ? "rentAircraft" : "boardAircraft", target: ground.Id)); return;
            }
            if (walker.Walker.UseStairs())
            {
                var b = walker.Walker.Inside; int floor = walker.Walker.Floor;
                var use = floor < 0 ? (b.BasementUses != null && -floor - 1 < b.BasementUses.Count ? b.BasementUses[-floor - 1] : null) : (b.FloorUses != null && floor < b.FloorUses.Count ? b.FloorUses[floor] : null);
                session.Say($"抵达{(floor < 0 ? $"地下 {-floor} 层" : $"{floor + 1} 层")}{(use != null ? " · " + use : "")}。再次按 E 使用楼梯与升降。", true); return;
            }
            if (walker.Walker.BlockedAccess != null) { session.Say(walker.Walker.BlockedAccess, false); walker.Walker.BlockedAccess = null; return; }
            var building = walker.Walker.Inside ?? world.Buildings.Where(b => D(feet, b.Door) < 18).OrderBy(b => D(feet, b.Door)).FirstOrDefault();
            if (building != null && walker.Walker.UseDoor(building))
                session.Say(walker.Walker.Inside != null ? $"进入{building.Name}，可在右侧面板使用设施。楼内左后角为楼梯。" : $"走出{building.Name}。", true);
            else if (walker.Walker.BlockedAccess != null) { session.Say(walker.Walker.BlockedAccess, false); walker.Walker.BlockedAccess = null; }
        }

        void UpdateSky()
        {
            if (sun == null) return;
            double hour = session?.Frame?.Hour ?? 10;
            float angle = (float)((hour - 6) / 24 * Math.PI * 2), altitude = Mathf.Sin(angle);
            float daylight = Mathf.SmoothStep(0, 1, Mathf.InverseLerp(-.12f, .28f, altitude));
            var sunGame = new Vector3(-Mathf.Cos(angle) * 2500, altitude * 2500, altitude * 1400); // already mirrored X
            sun.transform.rotation = Quaternion.LookRotation(-sunGame.normalized);
            float energy = (float)((session?.Frame?.Energy ?? 100) / 100);
            sun.intensity = Mathf.Lerp(.05f, 1.15f, daylight);
            sun.color = Color.Lerp(new Color(.55f, .62f, .9f), new Color(1f, .95f, .86f), daylight);
            RenderSettings.ambientSkyColor = Color.Lerp(new Color(.08f, .1f, .16f), new Color(.62f, .72f, .82f), daylight);
            RenderSettings.ambientEquatorColor = Color.Lerp(new Color(.06f, .07f, .1f), new Color(.55f, .6f, .58f), daylight);
            RenderSettings.ambientGroundColor = Color.Lerp(new Color(.03f, .03f, .04f), new Color(.35f, .33f, .28f), daylight);
            float visibility = (float)(session?.Frame?.Visibility ?? 1);
            RenderSettings.fogColor = Color.Lerp(new Color(.13f, .23f, .3f), new Color(.74f, .84f, .87f), daylight);
            RenderSettings.fogDensity = .0005f + (1 - visibility) * .0008f;
            if (view != null) { view.clearFlags = CameraClearFlags.SolidColor; view.backgroundColor = RenderSettings.fogColor; }
            studio?.SetLighting(daylight, Mathf.Clamp01(energy));
        }

        // ───────────────────────────── HUD ─────────────────────────────
        GUIStyle label, small, title, box;
        static readonly Dictionary<string, string> RoleNames = new Dictionary<string, string> { ["traveler"] = "星际旅行者", ["police"] = "警察", ["soldier"] = "卫士", ["teacher"] = "教师", ["driver"] = "驾驶员", ["merchant"] = "商人", ["mayor"] = "市长", ["scientist"] = "科研人员", ["official"] = "公务员", ["council"] = "议员" };

        void OnGUI()
        {
            label ??= new GUIStyle(GUI.skin.label) { fontSize = 15, wordWrap = true };
            small ??= new GUIStyle(GUI.skin.label) { fontSize = 13, wordWrap = true };
            title ??= new GUIStyle(GUI.skin.label) { fontSize = 18, fontStyle = FontStyle.Bold, wordWrap = true };
            box ??= new GUIStyle(GUI.skin.box) { alignment = TextAnchor.UpperLeft };
            if (status != null) { GUI.Box(new UnityEngine.Rect(20, 20, 760, 70), GUIContent.none, box); GUI.Label(new UnityEngine.Rect(32, 30, 740, 60), status + (session != null && session.State != SimSession.Phase.Ready ? "\n" + session.Status : ""), label); return; }
            var frame = session.Frame;
            if (session.State == SimSession.Phase.Failed) GUI.Label(new UnityEngine.Rect(20, Screen.height - 120, 900, 100), "模拟未运行：" + session.Status, label);
            if (frame == null) { GUI.Label(new UnityEngine.Rect(20, 20, 900, 30), session.Status, label); return; }

            // Status bar
            GUI.Box(new UnityEngine.Rect(12, 12, 520, 118), GUIContent.none, box);
            int h = (int)Math.Floor(frame.Hour), m = (int)Math.Floor((frame.Hour - h) * 60);
            var p = frame.Player;
            GUI.Label(new UnityEngine.Rect(24, 18, 500, 24), $"第 {frame.Day + 1} 日 {h:00}:{m:00} · {frame.Weather} · 能源 {frame.Energy:0}% · 倍率 {frame.Speed}×{(frame.Paused ? " · 已暂停" : "")}", label);
            GUI.Label(new UnityEngine.Rect(24, 42, 500, 24), $"{(RoleNames.TryGetValue(p.Role ?? "", out var role) ? role : p.Role)} · {p.Money:0.##} 云币 · 声望 {p.Reputation:0}{(p.Alive ? "" : " · 生命已结束")}", label);
            GUI.Label(new UnityEngine.Rect(24, 66, 500, 22), $"饥饿 {p.Hunger:0}  精力 {p.Fatigue:0}  社交 {p.Social:0}  娱乐 {p.Fun:0}  ·  居民 {life?.Residents ?? 0} 位在视野", small);
            var feet = walker.Feet;
            GUI.Label(new UnityEngine.Rect(24, 88, 500, 22), $"{(walker.Walker.Inside != null ? walker.Walker.Inside.Name + $" {walker.Walker.Floor + 1} 层 · " : "")}位置 {feet.X:0.0} / {feet.Y:0.0} / {feet.Z:0.0} · 模拟 {frame.StepMs:0} ms/步", small);
            GUI.Label(new UnityEngine.Rect(24, 108, 500, 22), frame.NavigationDestination != null ? $"导航至 {frame.NavigationDestination}{(frame.NavigationUnavailable != null ? "（暂不可达）" : "")}" : "", small);

            // Time and save controls
            float x = Screen.width - 430;
            if (GUI.Button(new UnityEngine.Rect(x, 14, 90, 28), frame.Paused ? "继续 · F" : "暂停 · F")) session.Command(Cmd("pause", frame.Paused ? 0 : 1));
            double[] speeds = { 1, 2, 4, 8 };
            for (int i = 0; i < speeds.Length; i++) if (GUI.Button(new UnityEngine.Rect(x + 96 + i * 46, 14, 42, 28), $"{speeds[i]}×")) session.Command(Cmd("speed", speeds[i]));
            if (GUI.Button(new UnityEngine.Rect(x + 284, 14, 66, 28), "保存")) session.Save(true);
            if (GUI.Button(new UnityEngine.Rect(x + 354, 14, 66, 28), "读档")) session.Load();

            DrawContext(frame);

            // Notice and events
            if (session.Notice != null && Time.unscaledTime - session.NoticeAt < 8)
            {
                var color = GUI.color; GUI.color = session.NoticeOk ? Color.white : new Color(1f, .75f, .7f);
                GUI.Box(new UnityEngine.Rect(Screen.width / 2f - 360, Screen.height - 150, 720, 54), GUIContent.none, box);
                GUI.Label(new UnityEngine.Rect(Screen.width / 2f - 350, Screen.height - 146, 700, 50), session.Notice, label);
                GUI.color = color;
            }
            var events = session.EventLog.Skip(Math.Max(0, session.EventLog.Count - 6)).ToList();
            GUI.Box(new UnityEngine.Rect(12, Screen.height - 20 - events.Count * 20 - 12, 560, events.Count * 20 + 16), GUIContent.none, box);
            for (int i = 0; i < events.Count; i++) GUI.Label(new UnityEngine.Rect(22, Screen.height - 24 - (events.Count - i) * 20, 548, 20), events[i].Text, small);
            if (showHelp) GUI.Label(new UnityEngine.Rect(Screen.width / 2f - 360, Screen.height - 34, 760, 24), "点击锁定鼠标 · WASD 行走 · Shift 冲刺 · E 门/楼梯/上下车 · F 暂停 · B/X 放置/回收体素 · V 航空器返航 · H 隐藏提示 · Esc 释放鼠标", small);
        }

        void DrawContext(SimFrame frame)
        {
            var sections = session.Context;
            if (sections.Count == 0) return;
            float width = 400, left = Screen.width - width - 12, top = 52, height = Mathf.Min(Screen.height - 220, 560);
            GUI.Box(new UnityEngine.Rect(left, top, width, height), GUIContent.none, box);
            contextTab = Mathf.Clamp(contextTab, 0, sections.Count - 1);
            for (int i = 0; i < sections.Count; i++)
            {
                string name = sections[i].Kind == "building" ? "场所" : sections[i].Kind == "citizen" ? "居民" : sections[i].Kind == "aircraft" ? "航空器" : "载具";
                if (GUI.Toggle(new UnityEngine.Rect(left + 8 + i * 70, top + 6, 66, 24), contextTab == i, name, GUI.skin.button)) contextTab = i;
            }
            var section = sections[contextTab];
            GUILayout.BeginArea(new UnityEngine.Rect(left + 8, top + 36, width - 16, height - 44));
            contextScroll = GUILayout.BeginScrollView(contextScroll);
            GUILayout.Label(section.Eyebrow, small);
            GUILayout.Label(section.Title, title);
            if (!string.IsNullOrEmpty(section.Subtitle)) GUILayout.Label(section.Subtitle, small);
            foreach (var action in section.Actions)
            {
                GUI.enabled = !action.Disabled;
                if (GUILayout.Button(action.Label, GUILayout.MinHeight(26)))
                {
                    if (action.Client == "interact") Interact();
                    else if (action.Command != null) Execute(new Dictionary<string, object>(action.Command));
                }
                GUI.enabled = true;
            }
            if (section.Kind == "building" && section.Actions.Any(a => a.Command != null && (string)a.Command["type"] == "deposit"))
            {
                GUILayout.BeginHorizontal();
                foreach (var amount in new double[] { 100, 300, 1000 }) if (GUILayout.Toggle(session.BankAmount == amount, $"{amount} 云币", GUI.skin.button)) session.BankAmount = amount;
                GUILayout.EndHorizontal();
            }
            foreach (var note in section.Notes) GUILayout.Label(note, small);
            GUILayout.EndScrollView();
            GUILayout.EndArea();
        }

        void OnDestroy() => session?.Dispose();
        void OnApplicationQuit() => session?.Dispose();
    }
}
