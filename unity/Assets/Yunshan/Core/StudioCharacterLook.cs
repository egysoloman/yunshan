// Port of src/rendering/studio-character-look.ts: which studio masters dress a
// resident, the skeleton's rest pose from a body's joint ports, rigid mounts,
// garment joint mapping and the displacement-driven pose. Display only.
// Parity-tested against TypeScript (scripts/parity/characters.ts).
using System;
using System.Collections.Generic;
using System.Linq;

namespace Yunshan.Core
{
    public sealed class CharacterContext
    {
        public double Age = 30; public string Role = "", State = "", Weather = ""; public double Hour; public double? Health; public bool Pregnant; public string Ceremony; public bool InfantNearby;
    }
    public sealed class CharacterPart { public string Asset, Mount; }
    public sealed class CharacterLook { public string Rig, Body; public List<CharacterPart> Parts = new List<CharacterPart>(); }

    public static class StudioCharacterLook
    {
        public static uint Seed(string id)
        {
            uint value = 2166136261;
            // `for (const char of id)` walks code points; charCodeAt(0) is the first UTF-16 unit of each.
            for (int i = 0; i < id.Length; i++) { char c = id[i]; value = unchecked((value ^ c) * 16777619u); if (char.IsHighSurrogate(c) && i + 1 < id.Length && char.IsLowSurrogate(id[i + 1])) i++; }
            return value;
        }

        static readonly string[] ShortHair = { "CHAR-085", "CHAR-086", "CHAR-087", "CHAR-088" };
        static readonly string[] LongHair = { "CHAR-089", "CHAR-090", "CHAR-091", "CHAR-092", "CHAR-093" };
        sealed class Outfit { public string[] Top, Tool, Extra; public string Hat; }
        static readonly Dictionary<string, Outfit> RoleOutfit = new Dictionary<string, Outfit>
        {
            ["警察"] = new Outfit { Top = new[] { "CHAR-127" }, Hat = "CHAR-101", Tool = new[] { "CHAR-198", "CHAR-197", "CHAR-196" }, Extra = new[] { "CHAR-150" } },
            ["医生"] = new Outfit { Top = new[] { "CHAR-132", "CHAR-133" }, Hat = "CHAR-106", Tool = new[] { "CHAR-193", "CHAR-195", "CHAR-194" }, Extra = new[] { "CHAR-111" } },
            ["老师"] = new Outfit { Top = new[] { "CHAR-116" }, Tool = new[] { "CHAR-189", "CHAR-190" } },
            ["学生"] = new Outfit { Top = new[] { "CHAR-113" }, Tool = new[] { "CHAR-189" }, Extra = new[] { "CHAR-147" } },
            ["农民"] = new Outfit { Top = new[] { "CHAR-131" }, Hat = "CHAR-104", Tool = new[] { "CHAR-201", "CHAR-202" } },
            ["钱庄职员"] = new Outfit { Top = new[] { "CHAR-135" }, Tool = new[] { "CHAR-192", "CHAR-191" }, Extra = new[] { "CHAR-150" } },
            ["商人"] = new Outfit { Top = new[] { "CHAR-135", "CHAR-136" }, Hat = "CHAR-105", Tool = new[] { "CHAR-185", "CHAR-181", "CHAR-191" } },
            ["官员"] = new Outfit { Top = new[] { "CHAR-137" }, Hat = "CHAR-100", Tool = new[] { "CHAR-192" }, Extra = new[] { "CHAR-150" } },
            ["驾驶员"] = new Outfit { Top = new[] { "CHAR-129", "CHAR-144" }, Tool = new[] { "CHAR-197" }, Extra = new[] { "CHAR-143" } },
            ["工人"] = new Outfit { Top = new[] { "CHAR-130" }, Hat = "CHAR-103", Tool = new[] { "CHAR-199", "CHAR-200" }, Extra = new[] { "CHAR-149", "CHAR-142", "CHAR-112" } },
            ["搬运工"] = new Outfit { Top = new[] { "CHAR-117", "CHAR-128" }, Hat = "CHAR-102", Tool = new[] { "CHAR-203" } },
            ["科研员"] = new Outfit { Top = new[] { "CHAR-134" }, Tool = new[] { "CHAR-191" }, Extra = new[] { "CHAR-109" } },
        };
        static readonly HashSet<string> WornTools = new HashSet<string> { "CHAR-147", "CHAR-148", "CHAR-149", "CHAR-142", "CHAR-143", "CHAR-150" };
        static readonly Dictionary<string, string> WornMount = new Dictionary<string, string> { ["CHAR-147"] = "back", ["CHAR-148"] = "satchel", ["CHAR-149"] = "waist", ["CHAR-150"] = "badge", ["CHAR-142"] = "wrist-right", ["CHAR-143"] = "skin" };

        public static CharacterLook Look(string id, CharacterContext context)
        {
            uint seed = Seed(id); double age = context.Age;
            string Pick(string[] list, int shift = 0) => list[(seed >> shift) % (uint)list.Length];
            var look = new CharacterLook(); void Add(string asset, string mount) => look.Parts.Add(new CharacterPart { Asset = asset, Mount = mount });
            bool night = context.Hour >= 22 || context.Hour < 6, rain = context.Weather.Contains("雨"), working = context.State == "working" || context.State == "responding";
            if (age < 2)
            {
                Add("CHAR-067", "neck"); Add("CHAR-125", "skin"); foreach (var side in new[] { "left", "right" }) Add("CHAR-071", "ankle-" + side);
                look.Rig = "CHAR-074"; look.Body = "CHAR-061"; return look;
            }
            if (age < 12)
            {
                Add("CHAR-068", "neck"); Add("CHAR-094", "neck"); Add("CHAR-123", "skin");
                if (age >= 6) { Add("CHAR-126", "skin"); if (context.State == "studying") Add("CHAR-189", "grip-right"); }
                foreach (var side in new[] { "left", "right" }) Add("CHAR-070", "wrist-" + side);
                look.Rig = "CHAR-074"; look.Body = age < 6 ? "CHAR-062" : "CHAR-063"; return look;
            }
            bool elder = age >= 62; string body = age < 18 ? "CHAR-064" : elder ? "CHAR-065" : seed % 2 != 0 ? "CHAR-060" : "CHAR-059";
            Add(elder ? "CHAR-069" : "CHAR-066", "neck"); Add("CHAR-098", "neck");
            foreach (var side in new[] { "left", "right" }) Add("CHAR-070", "wrist-" + side);
            RoleOutfit.TryGetValue(context.Role, out var outfit); bool robe = seed % 3 == 0, isLong = seed % 5 == 0;
            string hat = working && outfit?.Hat != null ? outfit.Hat : rain ? "CHAR-099" : null;
            Add(elder ? "CHAR-095" : isLong && hat == null ? Pick(LongHair, 3) : Pick(ShortHair, 3), "neck");
            if (hat != null) Add(hat, "neck"); else if (isLong && !elder && seed % 2 != 0) Add("CHAR-107", "neck");
            if (!elder && age >= 30 && seed % 7 == 0) Add("CHAR-096", "neck"); else if (elder && seed % 3 == 0) Add("CHAR-097", "neck");
            if (seed % 6 == 0 && context.Role != "科研员") Add("CHAR-108", "neck");
            if (seed % 8 == 1) Add("CHAR-110", "neck");
            if (context.Pregnant) Add("CHAR-072", "belly");
            if (context.Ceremony == "wedding") { Add("CHAR-138", "skin"); Add("CHAR-204", "grip-right"); }
            else if (context.Ceremony == "funeral") { Add("CHAR-139", "skin"); Add("CHAR-205", "grip-right"); }
            else if (context.State == "atHome" && night) Add("CHAR-124", "skin");
            else if (working && outfit != null)
            {
                Add(Pick(outfit.Top, 5), "skin");
                foreach (var extra in outfit.Extra ?? new string[0]) if (WornTools.Contains(extra) || seed % 2 == 0)
                {
                    Add(extra, WornMount.TryGetValue(extra, out var m) ? m : "neck");
                    if (extra == "CHAR-142") Add(extra, "wrist-left");
                }
                if (outfit.Tool != null) Add(Pick(outfit.Tool, 7), "grip-right");
            }
            else
            {
                if (robe) { Add("CHAR-114", "skin"); Add("CHAR-115", "skin"); } else { Add("CHAR-113", "skin"); if (seed % 4 == 2) Add("CHAR-117", "skin"); }
                if (seed % 6 == 3) Add("CHAR-120", "skin");
                if (elder && seed % 2 != 0) Add("CHAR-116", "skin");
                if (seed % 9 == 4) Add("CHAR-141", "skin");
                if (seed % 3 == 1) Add(seed % 2 != 0 ? "CHAR-148" : "CHAR-147", seed % 2 != 0 ? "satchel" : "back");
            }
            if (!robe && context.Ceremony == null && !(context.State == "atHome" && night)) Add(seed % 4 == 1 ? "CHAR-119" : "CHAR-118", "skin");
            Add(seed % 3 == 2 ? "CHAR-121" : "CHAR-122", "skin");
            if (rain) Add("CHAR-140", "skin");
            if (context.InfantNearby) Add("CHAR-206", "back");
            if ((context.Health ?? 100) < 35) { Add("CHAR-145", "skin"); Add("CHAR-146", "skin"); Add("CHAR-179", "grip-left"); }
            else if (elder && seed % 4 == 0) Add("CHAR-178", "grip-left");
            if (!working && string.IsNullOrEmpty(context.Ceremony))
            {
                string held = context.State == "shopping" ? (seed % 2 != 0 ? "CHAR-180" : "CHAR-181")
                    : context.State == "eating" ? "CHAR-182" : context.State == "socializing" ? (seed % 2 != 0 ? "CHAR-184" : "CHAR-207")
                    : context.State == "atHome" && !night ? Pick(new[] { "CHAR-186", "CHAR-187", "CHAR-188", "CHAR-208" }, 9) : rain ? "CHAR-177" : null;
                if (held != null) Add(held, "grip-right");
                if (context.State == "eating") Add("CHAR-183", "grip-left");
            }
            look.Rig = "CHAR-073"; look.Body = body; return look;
        }

        public static readonly string[] Assets = new[] { "CHAR-073", "CHAR-074", "CHAR-059", "CHAR-060", "CHAR-061", "CHAR-062", "CHAR-063", "CHAR-064", "CHAR-065", "CHAR-066", "CHAR-067", "CHAR-068", "CHAR-069", "CHAR-070", "CHAR-071", "CHAR-072" }
            .Concat(ShortHair).Concat(LongHair).Concat(new[] { "CHAR-094", "CHAR-095", "CHAR-096", "CHAR-097", "CHAR-098", "CHAR-099", "CHAR-100", "CHAR-101", "CHAR-102", "CHAR-103", "CHAR-104", "CHAR-105", "CHAR-106", "CHAR-107", "CHAR-108", "CHAR-109", "CHAR-110", "CHAR-111", "CHAR-112" })
            .Concat(Enumerable.Range(0, 38).Select(i => $"CHAR-{113 + i}")).Concat(Enumerable.Range(0, 32).Select(i => $"CHAR-{177 + i}")).ToArray();

        public static readonly string[] Joints = { "root", "pelvis", "spine", "chest", "neck", "head", "shoulder-left", "elbow-left", "wrist-left", "hand-left", "hip-left", "knee-left", "ankle-left", "toe-left",
            "shoulder-right", "elbow-right", "wrist-right", "hand-right", "hip-right", "knee-right", "ankle-right", "toe-right" };
        public static readonly Dictionary<string, string> Parent = new Dictionary<string, string>
        {
            ["root"] = null, ["pelvis"] = "root", ["spine"] = "pelvis", ["chest"] = "spine", ["neck"] = "chest", ["head"] = "neck",
            ["shoulder-left"] = "chest", ["elbow-left"] = "shoulder-left", ["wrist-left"] = "elbow-left", ["hand-left"] = "wrist-left", ["hip-left"] = "pelvis", ["knee-left"] = "hip-left", ["ankle-left"] = "knee-left", ["toe-left"] = "ankle-left",
            ["shoulder-right"] = "chest", ["elbow-right"] = "shoulder-right", ["wrist-right"] = "elbow-right", ["hand-right"] = "wrist-right", ["hip-right"] = "pelvis", ["knee-right"] = "hip-right", ["ankle-right"] = "knee-right", ["toe-right"] = "ankle-right",
        };

        /// <summary>Joint rotations (X, Z radians) for the simulation's pose.</summary>
        public static Dictionary<string, (double X, double Z)> Pose(double phase, bool walking, bool seated, bool dead)
        {
            var output = new Dictionary<string, (double, double)>(); void Set(string j, double x, double z = 0) => output[j] = (x, z);
            if (dead) { Set("root", -Math.PI / 2); return output; }
            if (seated) { foreach (var side in new[] { "left", "right" }) { Set("hip-" + side, Math.PI / 2); Set("knee-" + side, -Math.PI / 2); Set("shoulder-" + side, .7); Set("elbow-" + side, .5); } return output; }
            double swing = walking ? JsMath.Sin(phase) * .58 : 0;
            foreach (var (side, sign) in new[] { ("left", 1), ("right", -1) })
            {
                double leg = swing * sign;
                Set("hip-" + side, leg);
                Set("knee-" + side, walking ? -Math.Max(0, -leg) * 1.1 : 0);
                Set("shoulder-" + side, -leg * .8, side == "left" ? -.06 : .06);
                Set("elbow-" + side, walking ? .25 + Math.Max(0, -leg) * .3 : .1);
            }
            Set("spine", walking ? Math.Abs(swing) * .05 : 0);
            return output;
        }

        static double[] Port(IReadOnlyDictionary<string, double[]> ports, string name) => ports.TryGetValue(name, out var p) ? p : new double[] { 0, 0, 0 };
        public static string BodyJoint(double x, double y, IReadOnlyDictionary<string, double[]> ports)
        {
            double shoulderY = Port(ports, "shoulder--1")[1], hipY = Port(ports, "hip--1")[1], shoulderX = Math.Abs(Port(ports, "shoulder--1")[0]);
            string side = x < 0 ? "left" : "right", key = x < 0 ? "-1" : "1";
            if (Math.Abs(x) > shoulderX * .78 && y < shoulderY + .02 && y > Port(ports, "wrist-" + key)[1] - .2)
            {
                if (y > Port(ports, "elbow-" + key)[1]) return "shoulder-" + side;
                if (y > Port(ports, "wrist-" + key)[1]) return "elbow-" + side;
                return "wrist-" + side;
            }
            if (y < hipY - .02)
            {
                if (y > Port(ports, "knee-" + key)[1]) return "hip-" + side;
                if (y > Port(ports, "ankle-" + key)[1]) return "knee-" + side;
                return "ankle-" + side;
            }
            if (y > shoulderY - .06) return "chest";
            return y > (hipY + shoulderY) / 2 ? "spine" : "pelvis";
        }

        public static Dictionary<string, double[]> Rest(IReadOnlyDictionary<string, double[]> body)
        {
            double[] At(string id) { var p = Port(body, id); return new[] { p[0], p[1], p[2] }; }
            double hipY = At("hip--1")[1], chestY = At("shoulder--1")[1], k = (chestY - hipY) / .51; var neck = At("neck");
            var output = new Dictionary<string, double[]> { ["root"] = new double[] { 0, 0, 0 }, ["pelvis"] = new[] { 0, hipY, 0 }, ["spine"] = new[] { 0, hipY + (chestY - hipY) * .45, 0 }, ["chest"] = new[] { 0, chestY, 0 }, ["neck"] = neck, ["head"] = new[] { neck[0], neck[1] + .12 * k, neck[2] } };
            foreach (var (side, key) in new[] { ("left", "-1"), ("right", "1") })
            {
                var wrist = At("wrist-" + key); var ankle = At("ankle-" + key);
                output["shoulder-" + side] = At("shoulder-" + key); output["elbow-" + side] = At("elbow-" + key); output["wrist-" + side] = wrist; output["hand-" + side] = new[] { wrist[0], wrist[1] - .1275 * k, wrist[2] };
                output["hip-" + side] = At("hip-" + key); output["knee-" + side] = At("knee-" + key); output["ankle-" + side] = ankle; output["toe-" + side] = new[] { ankle[0], ankle[1] * .26, ankle[2] - .153 * k };
            }
            return output;
        }

        public static readonly double[] HandGrip = { 0, -.058, -.042 };
        public static (string Joint, double[] Offset) MountOffset(string mount, IReadOnlyDictionary<string, double[]> rest, IReadOnlyDictionary<string, double[]> body, IReadOnlyDictionary<string, double[]> partPorts, double[] min, double[] max)
        {
            (string, double[]) Rel(string joint, double x, double y, double z) => (joint, new[] { x - rest[joint][0], y - rest[joint][1], z - rest[joint][2] });
            var chest = rest["chest"]; var pelvis = rest["pelvis"];
            switch (mount)
            {
                case "neck": return ("neck", new double[] { 0, 0, 0 });
                case "wrist-left": case "wrist-right": { double w = partPorts.TryGetValue("wrist", out var wp) ? wp[1] : 0; return (mount, new[] { 0, -w, 0 }); }
                case "ankle-left": case "ankle-right": return (mount, new double[] { 0, 0, 0 });
                case "grip-left": case "grip-right":
                    {
                        string joint = mount == "grip-left" ? "wrist-left" : "wrist-right";
                        var g = partPorts.TryGetValue("grip", out var gp) ? gp : new[] { (min[0] + max[0]) / 2, max[1], (min[2] + max[2]) / 2 };
                        return (joint, new[] { HandGrip[0] - g[0], HandGrip[1] - g[1], HandGrip[2] - g[2] });
                    }
                case "back": return Rel("chest", 0, pelvis[1] - .1 - min[1], -min[2] + .12);
                case "satchel": { var s = body.TryGetValue("bag-shoulder", out var sp) ? sp : new[] { 0, chest[1], 0 }; return Rel("chest", 0, s[1] - max[1], 0); }
                case "waist": { var w = partPorts.TryGetValue("waist", out var wp) ? wp : new double[] { 0, 0, 0 }; return Rel("pelvis", 0, pelvis[1] + .02 - w[1], 0); }
                case "badge": { var c = partPorts.TryGetValue("clip", out var cp) ? cp : new double[] { 0, 0, 0 }; return Rel("chest", -.1 - c[0], chest[1] - .16 - c[1], -.15 - c[2]); }
                case "belly": return Rel("pelvis", 0, pelvis[1] + .04, 0);
            }
            throw new ArgumentException("unknown mount " + mount);
        }

        public static string GarmentJoint(string name)
        {
            if (name == "head") return "neck";
            var m = System.Text.RegularExpressions.Regex.Match(name, "^(shoulder|elbow|wrist|hip|knee|ankle)(-?)1$");
            if (m.Success) return m.Groups[1].Value + "-" + (m.Groups[2].Value.Length > 0 ? "left" : "right");
            return name;
        }
    }
}
