using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace Yunshan.Core.Host
{
    /// <summary>Error reported by the simulation host for one request.</summary>
    public sealed class SimHostException : Exception { public SimHostException(string message) : base(message) { } }

    /// <summary>Child-process client for the authoritative simulation host
    /// (src/native-host/sim-host.ts). One JSON object per line in each
    /// direction; requests are answered strictly in order. A background
    /// thread reads replies, so callers may await from any thread.</summary>
    public sealed class SimClient : IDisposable
    {
        readonly Process process;
        readonly StreamWriter input;
        readonly object writeLock = new object();
        readonly ConcurrentDictionary<int, TaskCompletionSource<object>> pending = new ConcurrentDictionary<int, TaskCompletionSource<object>>();
        readonly Thread reader, errors;
        readonly Queue<string> errorTail = new Queue<string>();
        int nextId;
        volatile bool disposed;

        /// <summary>Last lines the host wrote to stderr (diagnostics only).</summary>
        public string ErrorTail { get { lock (errorTail) return string.Join("\n", errorTail); } }
        public bool Running => !disposed && !process.HasExited;

        SimClient(Process process)
        {
            this.process = process;
            input = new StreamWriter(process.StandardInput.BaseStream, new UTF8Encoding(false)) { AutoFlush = true, NewLine = "\n" };
            reader = new Thread(ReadReplies) { IsBackground = true, Name = "云山模拟回复" };
            errors = new Thread(ReadErrors) { IsBackground = true, Name = "云山模拟诊断" };
            reader.Start(); errors.Start();
        }

        /// <summary>Starts <paramref name="node"/> with the given arguments
        /// (for example the bundled sim-host.mjs, or --import tsx and the
        /// TypeScript entry for a repository checkout).</summary>
        public static SimClient Start(string node, IEnumerable<string> arguments, string workingDirectory)
        {
            var info = new ProcessStartInfo(node)
            {
                UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = workingDirectory,
                RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8,
            };
            var args = new StringBuilder();
            foreach (var a in arguments) { if (args.Length > 0) args.Append(' '); args.Append(Quote(a)); }
            info.Arguments = args.ToString();
            var process = Process.Start(info) ?? throw new InvalidOperationException("无法启动模拟进程：" + node);
            return new SimClient(process);
        }

        static string Quote(string a) => a.Length > 0 && a.IndexOfAny(new[] { ' ', '"', '\t' }) < 0 ? a : "\"" + a.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";

        void ReadReplies()
        {
            try
            {
                var output = process.StandardOutput;
                string line;
                while ((line = output.ReadLine()) != null)
                {
                    object reply;
                    try { reply = Json.Parse(line); } catch (FormatException) { continue; }
                    var idValue = Json.Num(reply, "id", -1);
                    if (idValue < 0 || !pending.TryRemove((int)idValue, out var waiter)) continue;
                    if (Json.Bool(reply, "ok")) waiter.TrySetResult(((Dictionary<string, object>)reply).TryGetValue("result", out var result) ? result : null);
                    else waiter.TrySetException(new SimHostException(Json.Str(reply, "error", "模拟进程返回错误")));
                }
            }
            catch (Exception) { /* stream closed */ }
            FailAll("模拟进程已退出。" + (ErrorTail.Length > 0 ? "\n" + ErrorTail : ""));
        }

        void ReadErrors()
        {
            try
            {
                string line;
                while ((line = process.StandardError.ReadLine()) != null)
                    lock (errorTail) { errorTail.Enqueue(line); while (errorTail.Count > 40) errorTail.Dequeue(); }
            }
            catch (Exception) { /* stream closed */ }
        }

        void FailAll(string message)
        {
            foreach (var id in pending.Keys) if (pending.TryRemove(id, out var waiter)) waiter.TrySetException(new SimHostException(message));
        }

        /// <summary>Sends one request; fields are merged into the request object.</summary>
        public Task<object> Request(string op, IDictionary<string, object> fields = null)
        {
            if (disposed) throw new ObjectDisposedException(nameof(SimClient));
            int id = Interlocked.Increment(ref nextId);
            var request = new Dictionary<string, object> { ["id"] = id, ["op"] = op };
            if (fields != null) foreach (var pair in fields) request[pair.Key] = pair.Value;
            var waiter = new TaskCompletionSource<object>(TaskCreationOptions.RunContinuationsAsynchronously);
            pending[id] = waiter;
            var line = Json.Write(request);
            try { lock (writeLock) input.WriteLine(line); }
            catch (Exception error) { pending.TryRemove(id, out _); waiter.TrySetException(new SimHostException("无法写入模拟进程：" + error.Message)); }
            return waiter.Task;
        }

        public async Task<Dictionary<string, object>> Open(string save = null) => (Dictionary<string, object>)await Request("open", new Dictionary<string, object> { ["save"] = save }).ConfigureAwait(false);

        /// <summary>Advances real seconds of simulation and returns the new frame.
        /// <paramref name="player"/> is the walking body (ignored while riding or flying).</summary>
        public async Task<SimFrame> Step(double seconds, string mode, Vec3 player, Vec3 focus, double radius, double sinceEventId, IDictionary<string, object> extra = null)
        {
            var fields = new Dictionary<string, object> { ["seconds"] = seconds, ["mode"] = mode, ["radius"] = radius, ["sinceEventId"] = sinceEventId };
            if (player != null) fields["player"] = player;
            if (focus != null) fields["focus"] = focus;
            if (extra != null) foreach (var pair in extra) fields[pair.Key] = pair.Value;
            return SimFrame.From(await Request("step", fields).ConfigureAwait(false));
        }

        /// <summary>Runs a Simulation.command; returns (ok, message, frame).</summary>
        public async Task<(bool ok, string message, SimFrame frame)> Command(IDictionary<string, object> command, Vec3 focus, double radius, double sinceEventId)
        {
            var reply = await Request("command", new Dictionary<string, object> { ["command"] = command, ["focus"] = focus, ["radius"] = radius, ["sinceEventId"] = sinceEventId }).ConfigureAwait(false);
            var result = Json.Obj(reply, "result");
            return (Json.Bool(result, "ok"), Json.Str(result, "message", ""), SimFrame.From(Json.Obj(reply, "frame")));
        }

        public async Task<List<ContextSection>> Context(string mode, string insideBuildingId, double bankAmount = 100)
            => ContextSection.ListFrom(await Request("context", new Dictionary<string, object> { ["view"] = new Dictionary<string, object> { ["mode"] = mode, ["inside"] = insideBuildingId, ["bankAmount"] = bankAmount } }).ConfigureAwait(false));

        public async Task<string> Save() => Json.Str(await Request("save").ConfigureAwait(false), "save");

        /// <summary>Loads a save of the same city layout; (ok, message, reopen).</summary>
        public async Task<(bool ok, string message, bool reopen)> Load(string save)
        {
            var reply = await Request("load", new Dictionary<string, object> { ["save"] = save }).ConfigureAwait(false);
            var result = Json.Obj(reply, "result");
            return (Json.Bool(result, "ok"), Json.Str(result, "message", ""), Json.Bool(reply, "reopen"));
        }

        public void Dispose()
        {
            if (disposed) return;
            try { Request("quit"); } catch (Exception) { /* already gone */ }
            disposed = true;
            try { if (!process.WaitForExit(2000)) process.Kill(); } catch (Exception) { /* exited */ }
            FailAll("模拟客户端已关闭。");
            process.Dispose();
        }
    }
}
