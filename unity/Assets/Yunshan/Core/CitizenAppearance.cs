using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;

namespace Yunshan.Core
{
    /// <summary>C# port of src/rendering/citizen-appearance.ts describeCitizen:
    /// 0.2m-quantised body, garment and hair boxes in the citizen's local frame
    /// (game space, +Z forward). Presentation only, never biological identity.</summary>
    public static class CitizenAppearance
    {
        public sealed class Part
        {
            public string Name; public Vec3 Position, Size; public string Color; public Vec3 Pivot; public double RotationX; public bool Face; public int Garment;
        }
        public struct Pose { public double Yaw, Phase; public bool Walking, Seated, Dead; }

        static readonly string[] Skins = { "#d6b391", "#c89e7d", "#b98b69", "#e4c3a3", "#b77d5b" };
        static readonly string[] Coats = { "#365d5b", "#688478", "#47617e", "#8b6956", "#a98563", "#b49a72", "#6e7680", "#78617e" };
        static readonly string[] Pants = { "#3c4844", "#4b505c", "#61574e", "#40434f" };
        static readonly Regex Police = new Regex("警|police"), Soldier = new Regex("卫|soldier"), Official = new Regex("官|official"), Teacher = new Regex("师|teacher"), Merchant = new Regex("商|merchant");

        /// <summary>FNV-1a over code points' first UTF-16 unit, as the TS hash.</summary>
        public static uint Hash(string text)
        {
            uint value = 2166136261;
            for (int i = 0; i < text.Length; i++)
            {
                value = unchecked((value ^ text[i]) * 16777619);
                if (char.IsHighSurrogate(text[i]) && i + 1 < text.Length && char.IsLowSurrogate(text[i + 1])) i++;
            }
            return value;
        }
        static double Q(double n) => Math.Max(.2, JsMath.Round(n / .2) * .2);
        public static double BodyHeight(double age) => age < 2 ? .6 : age < 6 ? 1 : age < 12 ? 1.2 : age < 18 ? 1.6 : 1.8;
        public static int FaceStyle(double age, double mood = 60, double stress = 20) => (age >= 62 ? 1 : age < 18 ? 2 : 0) + (mood < 35 || stress > 70 ? 3 : 0);

        public static List<Part> Describe(string id, string role, double age, Pose pose, bool near)
        {
            uint seed = Hash(id);
            double height = BodyHeight(age);
            string clothing = seed % 3 == 0 ? "robe" : "jacket", hair = seed % 5 == 0 ? "long" : "short";
            bool hat = age >= 12 && (seed % 4 == 0 || Police.IsMatch(role) || Soldier.IsMatch(role) || Official.IsMatch(role)), bag = age >= 6 && seed % 3 == 1;
            string skin = Skins[seed % Skins.Length], hairColor = age >= 62 ? "#92938d" : seed % 4 == 0 ? "#5b4538" : "#2e302c";
            string coat = Police.IsMatch(role) ? "#546d85" : Soldier.IsMatch(role) ? "#69785c" : Teacher.IsMatch(role) ? "#7b977d" : Merchant.IsMatch(role) ? "#a87d50" : Coats[seed % Coats.Length];
            string trouser = Pants[(seed >> 3) % Pants.Length];
            var parts = new List<Part>();
            void Add(string name, Vec3 position, Vec3 size, string color, Vec3 pivot = null, double rotationX = 0, bool face = false, int garment = 0)
                => parts.Add(new Part { Name = name, Position = position, Size = size, Color = color, Pivot = pivot, RotationX = rotationX, Face = face, Garment = garment });
            Vec3 P(double x, double y, double z) => new Vec3(x, y, z);
            double headBase = height - .2, hip = Math.Max(.2, Math.Min(Q(height * .45), headBase - .2)), leg = Math.Max(.2, hip - .2), torso = Math.Max(.2, headBase - hip);
            Add("torso", P(0, hip + torso / 2, 0), P(.4, torso, .2), coat, garment: clothing == "robe" ? 2 : 1);
            Add("head", P(0, height - .1, 0), P(.2, .2, .2), skin, face: near);
            if (height <= .6) { Add("feet", P(0, .1, .1), P(.4, .2, .2), "#41423d"); return parts; }
            double swing = pose.Walking && !pose.Dead && !pose.Seated ? JsMath.Sin(pose.Phase) * .58 : 0;
            foreach (int side in new[] { -1, 1 })
            {
                double angle = pose.Seated ? -Math.PI / 2 : swing * side;
                if (near)
                {
                    double upper = Q(leg / 2), lower = Math.Max(.2, leg - upper);
                    Add($"thigh-{side}", P(side * .1, hip - upper / 2, 0), P(.2, upper, .2), trouser, P(side * .1, hip, 0), angle);
                    if (pose.Seated) Add($"calf-{side}", P(side * .1, hip - .1, upper), P(.2, lower, .2), trouser);
                    else Add($"calf-{side}", P(side * .1, hip - upper - lower / 2, 0), P(.2, lower, .2), trouser, P(side * .1, hip, 0), angle);
                    if (pose.Seated) Add($"shoe-{side}", P(side * .1, hip - lower, upper + .1), P(.2, .2, .4), "#3e413c");
                    else Add($"shoe-{side}", P(side * .1, .1, .1), P(.2, .2, .4), "#3e413c", P(side * .1, hip, 0), angle);
                }
                else Add($"leg-{side}", P(side * .1, hip - leg / 2, 0), P(.2, leg, .2), trouser, P(side * .1, hip, 0), angle);
                double arm = Math.Max(.2, Q(torso * .75)), armAngle = pose.Seated ? -.7 : -swing * side;
                Add($"sleeve-{side}", P(side * .3, headBase - arm / 2, 0), P(.2, arm, .2), coat, P(side * .3, headBase, 0), armAngle);
                if (near) Add($"hand-{side}", P(side * .3, headBase - arm - .1, 0), P(.2, .2, .2), skin, P(side * .3, headBase, 0), armAngle);
            }
            if (near)
            {
                Add("hair-back", P(0, height - .1, -.2), P(.2, .2, .2), hairColor);
                if (hair == "long") Add("long-hair", P(0, height - .3, -.2), P(.2, .4, .2), hairColor);
                if (clothing == "robe" && !pose.Seated) Add("robe", P(0, hip + .1, 0), P(.4, .4, .4), coat);
                if (hat) Add("hat", P(0, height + .1, 0), P(.4, .2, .4), Police.IsMatch(role) ? "#3f536c" : hairColor);
                if (bag) Add("satchel", P(.4, hip + .1, -.1), P(.2, .4, .2), "#806142");
            }
            return parts;
        }
    }
}
