using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using UnityEngine;
using Yunshan.Core;
using Yunshan.Core.Host;

namespace Yunshan.Runtime
{
    /// <summary>Owns the authoritative simulation host process. Advances it by
    /// real time with the player's walking body, keeps the newest frame, the
    /// event log and the context panel, and runs commands/save/load. Network
    /// replies arrive on worker threads and are applied on the main thread.</summary>
    public sealed class SimSession : IDisposable
    {
        public enum Phase { Starting, Ready, Failed }
        public Phase State { get; private set; } = Phase.Starting;
        public string Status { get; private set; } = "正在启动权威模拟……";
        public string Layout { get; private set; } = Yunshan.Core.World.CurrentCityLayout;
        public double Seed { get; private set; } = 20261001;
        /// <summary>The world the host simulates, sent by it after opening (null until Ready).</summary>
        public WorldDefinition World { get; private set; }
        /// <summary>Where a new player first looks (host-computed); null when unknown.</summary>
        public Vec3 ArrivalLook { get; private set; }
        public SimFrame Frame { get; private set; }
        public SimFrame PreviousFrame { get; private set; }
        public float FrameArrivedAt { get; private set; }
        public float FrameInterval { get; private set; } = .25f;
        public List<ContextSection> Context { get; private set; } = new List<ContextSection>();
        /// <summary>Overview panes; refreshed about once a second while <see cref="PanesOpen"/>.</summary>
        public List<Pane> Panes { get; private set; } = new List<Pane>();
        public bool PanesOpen;
        /// <summary>The welcome note's first-day list (host firstDay); null until received or once dismissed.</summary>
        public FirstDay FirstDay { get; private set; }
        /// <summary>The welcome note shows until it is dismissed or its first-day list is done (web ui.ts).</summary>
        public bool WelcomeOpen { get; private set; } = PlayerPrefs.GetInt(WelcomeSeenKey, 0) == 0;
        const string WelcomeSeenKey = "yunshan.ui.welcomeSeen.v1", FirstDayKey = "yunshan.ui.firstDay.v1";
        public readonly List<SimFrame.Event> EventLog = new List<SimFrame.Event>();
        public string Notice; public bool NoticeOk = true; public float NoticeAt;
        string firstDayNext; // said after the completing step's own notice has had its 8 s on screen
        public List<Vec3> Voxels = new List<Vec3>();
        public double BankAmount = 100;
        /// <summary>Game minutes advanced per real second over the last few seconds.</summary>
        public double EffectiveMinutesPerSecond { get; private set; }
        readonly Queue<(float at, double minutes)> rate = new Queue<(float, double)>();
        /// <summary>Raised on the main thread after the player is moved by the
        /// simulation (vehicles, aircraft, loads) or a walking step was refused.</summary>
        public event Action<SimFrame> PlayerMovedBySimulation;

        static string SavePath => Path.Combine(Application.persistentDataPath, "yunshan-save.json");
        readonly ConcurrentQueue<Action> mainThread = new ConcurrentQueue<Action>();
        SimClient client;
        bool stepPending, contextPending, panesPending, firstDayPending;
        float panesAt, firstDayAt;
        double accumulated, lastEventId;
        float contextAt, autosaveAt;
        string voxelKey = "";

        public void Start()
        {
            string bundle = Path.Combine(Application.streamingAssetsPath, "yunshan-sim"), repository = null;
#if UNITY_EDITOR
            repository = Path.GetFullPath(Path.Combine(Application.dataPath, "..", ".."));
#endif
            var launch = HostLaunch.Resolve(bundle, repository);
            if (launch == null) { Fail("未找到 Node.js 22+ 或模拟宿主。请安装 Node.js（或设置 YUNSHAN_NODE），并在仓库根目录运行 npm install 与 npm run build:sim-host。"); return; }
            Debug.Log("云山：" + launch.Description + "（" + launch.Node + "）");
            string save = null;
            try { if (File.Exists(SavePath)) save = File.ReadAllText(SavePath); } catch (Exception error) { Debug.LogWarning("云山：读取存档失败 " + error.Message); }
            Task.Run(async () =>
            {
                try
                {
                    client = launch.Start();
                    Dictionary<string, object> opened;
                    try { opened = await client.Open(save); }
                    catch (SimHostException error) when (save != null)
                    {
                        mainThread.Enqueue(() => Say("原存档无法读取，已开新城：" + error.Message, false));
                        opened = await client.Open(null);
                    }
                    var world = await client.World();
                    var frame = await client.Step(0, "walk", null, null, 260, 0);
                    mainThread.Enqueue(() =>
                    {
                        Layout = Json.Str(opened, "layout", Yunshan.Core.World.CurrentCityLayout); Seed = Json.Num(opened, "seed", 20261001); World = world; ArrivalLook = client.ArrivalLook;
                        Accept(frame, true);
                        State = Phase.Ready; Status = $"模拟就绪：{Json.Num(opened, "citizens")} 位居民 · {Json.Num(opened, "vehicles")} 辆载具";
                    });
                }
                catch (Exception error) { mainThread.Enqueue(() => Fail("模拟宿主启动失败：" + error.Message + (client != null && client.ErrorTail.Length > 0 ? "\n" + client.ErrorTail : ""))); }
            });
        }

        void Fail(string message) { State = Phase.Failed; Status = message; Debug.LogError("云山：" + message); }
        public void Say(string message, bool ok) { Notice = message; NoticeOk = ok; NoticeAt = Time.unscaledTime; }

        void Accept(SimFrame frame, bool moved)
        {
            float at = Time.unscaledTime;
            rate.Enqueue((at, frame.Ticks * .25 * frame.Speed));
            while (rate.Count > 0 && at - rate.Peek().at > 5) rate.Dequeue();
            double minutes = 0; foreach (var r in rate) minutes += r.minutes;
            EffectiveMinutesPerSecond = rate.Count > 1 ? minutes / Math.Max(.5, at - rate.Peek().at) : EffectiveMinutesPerSecond;
            PreviousFrame = Frame ?? frame; Frame = frame;
            float now = Time.unscaledTime; FrameInterval = Mathf.Clamp(now - FrameArrivedAt, .05f, 2f); FrameArrivedAt = now;
            foreach (var e in frame.Events) if (e.Id > lastEventId) EventLog.Add(e);
            if (EventLog.Count > 60) EventLog.RemoveRange(0, EventLog.Count - 60);
            lastEventId = Math.Max(lastEventId, frame.LastEventId);
            if (frame.Voxels != null) { Voxels = frame.Voxels; voxelKey = frame.VoxelKey ?? ""; }
            if (frame.Rejected != null) Say(frame.Rejected, false);
            if (frame.Notice != null) Say(frame.Notice, true);
            if (moved || frame.Rejected != null || frame.Player.VehicleId != null || frame.AircraftList.Exists(a => a.Active)) PlayerMovedBySimulation?.Invoke(frame);
        }

        /// <summary>Called every frame. Sends at most one step at a time; real
        /// time keeps accumulating while the host computes (capped at 1 s per
        /// request, as the web App caps a frame).</summary>
        public void Update(float deltaSeconds, string mode, Vec3 walkingBody, Vec3 focus, IDictionary<string, object> controls, string insideBuildingId)
        {
            while (mainThread.TryDequeue(out var action)) action();
            if (State != Phase.Ready || client == null) return;
            accumulated += deltaSeconds;
            if (!stepPending)
            {
                double seconds = Math.Min(accumulated, 1); accumulated = 0; stepPending = true;
                var extra = new Dictionary<string, object> { ["voxelKey"] = voxelKey };
                if (controls != null) foreach (var pair in controls) extra[pair.Key] = pair.Value;
                Run(client.Step(seconds, mode, walkingBody, focus, 260, lastEventId, extra), frame => { stepPending = false; Accept(frame, false); }, () => stepPending = false);
            }
            if (!contextPending && Time.unscaledTime - contextAt > .4f)
            {
                contextPending = true; contextAt = Time.unscaledTime;
                Run(client.Context(mode, insideBuildingId, BankAmount), sections => { contextPending = false; Context = sections; }, () => contextPending = false);
            }
            if (PanesOpen && !panesPending && Time.unscaledTime - panesAt > 1f)
            {
                panesPending = true; panesAt = Time.unscaledTime;
                Run(client.Panes(mode, insideBuildingId), panes => { panesPending = false; Panes = panes; }, () => panesPending = false);
            }
            if (firstDayNext != null && (Notice == null || Time.unscaledTime - NoticeAt >= 8)) { Say(firstDayNext, true); firstDayNext = null; }
            if (WelcomeOpen && !firstDayPending && Time.unscaledTime - firstDayAt > 1f)
            {
                firstDayPending = true; firstDayAt = Time.unscaledTime;
                var stored = PlayerPrefs.GetString(FirstDayKey, "").Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries);
                Run(client.FirstDaySteps(stored), list =>
                {
                    // The step that completes the day says so once, with what to do next (web first-day.ts firstDayNext).
                    if (list.Complete && FirstDay != null && !FirstDay.Complete && list.Next != null) firstDayNext = list.Next;
                    firstDayPending = false; FirstDay = list;
                    PlayerPrefs.SetString(FirstDayKey, string.Join(",", list.Steps.FindAll(step => step.Done).ConvertAll(step => step.Id)));
                    if (list.Complete) DismissWelcome();
                }, () => firstDayPending = false);
            }
            if (Time.unscaledTime - autosaveAt > 30) { autosaveAt = Time.unscaledTime; Save(false); }
        }

        void Run<T>(Task<T> task, Action<T> done, Action failed)
        {
            task.ContinueWith(t => mainThread.Enqueue(() =>
            {
                if (t.IsFaulted) { failed?.Invoke(); var error = t.Exception?.GetBaseException(); Say(error is SimHostException ? error.Message : "模拟通信失败：" + error?.Message, false); if (client != null && !client.Running) Fail("模拟进程已退出：" + client.ErrorTail); }
                else done(t.Result);
            }));
        }

        /// <summary>Runs Simulation.command and reports its message.</summary>
        public void Command(IDictionary<string, object> command, Action<bool> after = null)
        {
            if (State != Phase.Ready) return;
            Run(client.Command(command, null, 260, lastEventId), result =>
            {
                Say(result.message, result.ok); Accept(result.frame, result.ok);
                after?.Invoke(result.ok);
                contextAt = 0; panesAt = 0;
            }, null);
        }

        /// <summary>One click on an open first-day step: the host plans the route to where it can be done now.</summary>
        public void FirstDayGo(string step)
        {
            if (State != Phase.Ready) return;
            Run(client.FirstDayGo(step, lastEventId), result => { Say(result.message, result.ok); Accept(result.frame, false); panesAt = 0; }, null);
        }

        public void DismissWelcome() { WelcomeOpen = false; PlayerPrefs.SetInt(WelcomeSeenKey, 1); PlayerPrefs.Save(); }

        public void Save(bool explicitSave)
        {
            if (State != Phase.Ready) return;
            Run(client.Save(), save =>
            {
                try { File.WriteAllText(SavePath + ".tmp", save); if (File.Exists(SavePath)) File.Delete(SavePath); File.Move(SavePath + ".tmp", SavePath); if (explicitSave) Say("旅程已保存：" + SavePath, true); }
                catch (Exception error) { Say("无法写入存档：" + error.Message, false); }
            }, null);
        }

        public void Load()
        {
            if (State != Phase.Ready) return;
            if (!File.Exists(SavePath)) { Say("还没有存档。", false); return; }
            string save;
            try { save = File.ReadAllText(SavePath); } catch (Exception error) { Say("读取存档失败：" + error.Message, false); return; }
            Run(client.Load(save), result =>
            {
                Say(result.message, result.ok);
                if (result.ok) Run(client.Step(0, "walk", null, null, 260, 0), frame => Accept(frame, true), null);
            }, null);
        }

        /// <summary>Removes the saved journey (the next start opens a new city).</summary>
        public void DeleteSave()
        {
            try { if (File.Exists(SavePath)) File.Delete(SavePath); autosaveAt = float.PositiveInfinity; }
            catch (Exception error) { Say("无法删除存档：" + error.Message, false); }
        }

        public void Dispose() { client?.Dispose(); client = null; State = Phase.Failed; Status = "模拟已关闭。"; }
    }
}
