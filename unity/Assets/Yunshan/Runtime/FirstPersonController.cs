using System;
using System.Collections.Generic;
using UnityEngine;
using Yunshan.Core;

namespace Yunshan.Runtime
{
    /// <summary>Input and camera for the player's body. Walking uses the C#
    /// port of the web controller (PlayerWalker: doors, stairs, permissions,
    /// counters, rails, voxels) at 4.8 m/s or 10 m/s with Shift. While riding,
    /// driving or flying the simulation moves the body and this only looks.</summary>
    public sealed class FirstPersonController : MonoBehaviour
    {
        public PlayerWalker Walker { get; private set; }
        public bool Passenger;          // riding or driving a vehicle (simulation moves the body)
        public bool Driving;            // the player holds the driving controls
        public Vec3 AircraftPosition;   // set while in an aircraft
        public double JetSpeed = 85;
        public float MouseSensitivity = 1;
        /// <summary>True while the pointer is over an on-screen panel.</summary>
        public Func<bool> PointerOverUi = () => false;
        Camera view;
        float lastClick = -1;

        public Vec3 Feet => Walker.Feet;
        public string Mode => Walker.Mode;

        public void Initialise(WorldDefinition world, Camera camera, Func<Building, int, bool> canAccess, Func<IReadOnlyList<Vec3>> voxels)
        {
            view = camera;
            Walker = new PlayerWalker(world, canAccess, voxels);
            Apply();
        }

        static float Key(KeyCode a, KeyCode b) => Input.GetKey(a) || Input.GetKey(b) ? 1 : 0;
        public float Forward => Key(KeyCode.W, KeyCode.UpArrow) - Key(KeyCode.S, KeyCode.DownArrow);
        public float Strafe => Key(KeyCode.D, KeyCode.RightArrow) - Key(KeyCode.A, KeyCode.LeftArrow);
        bool Sprint => Input.GetKey(KeyCode.LeftShift) || Input.GetKey(KeyCode.RightShift);

        /// <summary>Same fields as the web controller's drivingControls.</summary>
        public Dictionary<string, object> DrivingControls() => new Dictionary<string, object> { ["throttle"] = (double)Forward, ["turn"] = (double)Strafe, ["brake"] = Input.GetKey(KeyCode.Space) };

        /// <summary>Same fields as the web controller's aviationControls.</summary>
        public Dictionary<string, object> AviationControls() => new Dictionary<string, object>
        {
            ["forward"] = (double)Forward, ["strafe"] = (double)Strafe,
            ["climb"] = (double)(Key(KeyCode.R, KeyCode.Space) - Key(KeyCode.Q, KeyCode.LeftControl)),
            ["yaw"] = Walker.Yaw, ["pitch"] = Walker.Pitch, ["speed"] = JetSpeed, ["boost"] = Sprint,
        };

        void Update()
        {
            if (Walker == null) return;
            // As the web: drag to look, double-click the scene to lock the pointer.
            bool overUi = Cursor.lockState != CursorLockMode.Locked && PointerOverUi();
            if (Input.GetMouseButtonDown(0) && !overUi)
            {
                if (Time.unscaledTime - lastClick < .35f) { Cursor.lockState = CursorLockMode.Locked; Cursor.visible = false; }
                lastClick = Time.unscaledTime;
            }
            if (Input.GetKeyDown(KeyCode.Escape)) { Cursor.lockState = CursorLockMode.None; Cursor.visible = true; }
            if (Cursor.lockState == CursorLockMode.Locked || !overUi && (Input.GetMouseButton(0) || Input.GetMouseButton(1)))
            {
                // The web turns 0.003 rad per pixel horizontally and 0.0025 vertically.
                Walker.Yaw -= Input.GetAxis("Mouse X") * .03 * MouseSensitivity;
                Walker.Pitch = Math.Max(-1.48, Math.Min(1.48, Walker.Pitch + Input.GetAxis("Mouse Y") * .025 * MouseSensitivity));
            }
            float wheel = Input.mouseScrollDelta.y;
            if (wheel != 0 && Mode != "walk") JetSpeed = Math.Max(25, Math.Min(Mode == "jet" ? 250 : 150, JetSpeed + wheel * 6));
            if (Mode == "walk" && !Passenger && (Forward != 0 || Strafe != 0))
            {
                // Replay the frame in ≤1/30 s collision slices, at most one second.
                double remaining = Math.Min(Time.deltaTime, 1);
                while (remaining > 1e-8) { double dt = Math.Min(remaining, 1.0 / 30); Walker.Step(dt, Forward, Strafe, Sprint, false); remaining -= dt; }
            }
            Apply();
        }

        void Apply()
        {
            if (view == null || Walker == null) return;
            var feet = Walker.Feet;
            Vector3 eye = Mode != "walk" && AircraftPosition != null ? Space.ToUnity(AircraftPosition.X, AircraftPosition.Y + 1.15, AircraftPosition.Z)
                : Space.ToUnity(feet.X, feet.Y + PlayerWalker.EyeHeight + (Passenger ? .5 : 0), feet.Z);
            view.transform.SetPositionAndRotation(eye, Space.Camera(Walker.Yaw, Walker.Pitch));
        }

        /// <summary>Camera direction in game space (for placing voxels).</summary>
        public Vec3 GameDirection()
        {
            double c = Math.Cos(Walker.Pitch);
            return new Vec3(-Math.Sin(Walker.Yaw) * c, Math.Sin(Walker.Pitch), -Math.Cos(Walker.Yaw) * c);
        }
    }
}
