using UnityEngine;
using Yunshan.Core;

namespace Yunshan.Runtime
{
    /// <summary>Game space is right-handed (as Three.js and glTF); Unity is
    /// left-handed. glTFast imports glTF by negating X, so game positions map
    /// the same way and yaw angles change sign. Keep every conversion here.</summary>
    public static class Space
    {
        public static Vector3 ToUnity(Vec3 v) => new Vector3(-(float)v.X, (float)v.Y, (float)v.Z);
        public static Vector3 ToUnity(double x, double y, double z) => new Vector3(-(float)x, (float)y, (float)z);
        public static Vec3 ToGame(Vector3 v) => new Vec3(-v.x, v.y, v.z);
        /// <summary>Game yaw (radians, right-handed about +Y) to a Unity rotation.</summary>
        public static Quaternion Yaw(double radians) => Quaternion.Euler(0, -(float)(radians * Mathf.Rad2Deg), 0);

        /// <summary>Web camera angles (three.js YXZ: forward −Z at yaw 0, positive
        /// pitch looks up) to a Unity camera rotation in mirrored space.</summary>
        public static Quaternion Camera(double yaw, double pitch) => Quaternion.Euler(-(float)(pitch * Mathf.Rad2Deg), 180f - (float)(yaw * Mathf.Rad2Deg), 0);

        static readonly System.Collections.Generic.Dictionary<string, Color> HexCache = new System.Collections.Generic.Dictionary<string, Color>();
        /// <summary>sRGB hex to a shader colour (linearised in linear colour space). Cached.</summary>
        public static Color Hex(string hex)
        {
            if (HexCache.TryGetValue(hex, out var cached)) return cached;
            ColorUtility.TryParseHtmlString(hex, out var c);
            var result = QualitySettings.activeColorSpace == ColorSpace.Linear ? c.linear : c;
            HexCache[hex] = result; return result;
        }
    }
}
