// JavaScript-identical numeric primitives for the Yunshan simulation core.
//
// The TypeScript game is the behavioural reference. Generation and simulation
// quantise to a 0.2m grid and compare against thresholds, so a 1-ULP difference
// in sin/exp/hypot can move a building or change a route. .NET/Mono/IL2CPP use
// each platform's libm, which differ from V8 and from each other. These are
// line-by-line ports of the code Node 22 (V8 12.4) actually runs:
//   - sin, cos, exp, atan, atan2: fdlibm in deps/v8/src/base/ieee754.cc
//     (Node does not enable V8_USE_LIBM_TRIG_FUNCTIONS);
//   - hypot: MathHypot in deps/v8/src/builtins/math.tq (Kahan sum);
//   - round: ECMAScript Math.round (ties toward +Infinity, keeps -0).
// fdlibm: Copyright (C) 1993-2004 by Sun Microsystems, Inc. Permission to use,
// copy, modify, and distribute this software is freely granted, provided that
// this notice is preserved.
//
// Do not let a compiler fuse a*b+c into FMA for this file (IL2CPP on ARM may):
// results are verified against V8 only for separately rounded operations.
using System;
using System.Globalization;

namespace Yunshan.Core
{
    public static class JsMath
    {
        public const double PI = 3.141592653589793;

        static int High(double d) => (int)(BitConverter.DoubleToInt64Bits(d) >> 32);
        static uint Low(double d) => (uint)BitConverter.DoubleToInt64Bits(d);
        static double Words(int hi, uint lo) => BitConverter.Int64BitsToDouble(((long)hi << 32) | lo);
        static double WithHigh(double d, int hi) => Words(hi, Low(d));
        static double WithLow(double d, uint lo) => Words(High(d), lo);

        static double ScaleB(double x, int n)
        {
            // Exact power-of-two scaling within the double range (as scalbn).
            while (n > 1000) { x *= 1.0715086071862673e301; n -= 1000; }
            while (n < -1000) { x *= 9.332636185032189e-302; n += 1000; }
            return x * BitConverter.Int64BitsToDouble((long)(n + 1023) << 52);
        }

        static readonly int[] TwoOverPi = {
            0xA2F983, 0x6E4E44, 0x1529FC, 0x2757D1, 0xF534DD, 0xC0DB62, 0x95993C,
            0x439041, 0xFE5163, 0xABDEBB, 0xC561B7, 0x246E3A, 0x424DD2, 0xE00649,
            0x2EEA09, 0xD1921C, 0xFE1DEB, 0x1CB129, 0xA73EE8, 0x8235F5, 0x2EBB44,
            0x84E99C, 0x7026B4, 0x5F7E41, 0x3991D6, 0x398353, 0x39F49C, 0x845F8B,
            0xBDF928, 0x3B1FF8, 0x97FFDE, 0x05980F, 0xEF2F11, 0x8B5A0A, 0x6D1F6D,
            0x367ECF, 0x27CB09, 0xB74F46, 0x3F669E, 0x5FEA2D, 0x7527BA, 0xC7EBE5,
            0xF17B3D, 0x0739F7, 0x8A5292, 0xEA6BFB, 0x5FB11F, 0x8D5D08, 0x560330,
            0x46FC7B, 0x6BABF0, 0xCFBC20, 0x9AF436, 0x1DA9E3, 0x91615E, 0xE61B08,
            0x659985, 0x5F14A0, 0x68408D, 0xFFD880, 0x4D7327, 0x310606, 0x1556CA,
            0x73A8C9, 0x60E27B, 0xC08C6B,
        };
        static readonly int[] NPio2Hw = {
            0x3FF921FB, 0x400921FB, 0x4012D97C, 0x401921FB, 0x401F6A7A, 0x4022D97C,
            0x4025FDBB, 0x402921FB, 0x402C463A, 0x402F6A7A, 0x4031475C, 0x4032D97C,
            0x40346B9C, 0x4035FDBB, 0x40378FDB, 0x403921FB, 0x403AB41B, 0x403C463A,
            0x403DD85A, 0x403F6A7A, 0x40407E4C, 0x4041475C, 0x4042106C, 0x4042D97C,
            0x4043A28C, 0x40446B9C, 0x404534AC, 0x4045FDBB, 0x4046C6CB, 0x40478FDB,
            0x404858EB, 0x404921FB,
        };

        static int RemPio2(double x, double[] y)
        {
            const double half = 5.00000000000000000000e-01, two24 = 1.67772160000000000000e+07,
                invpio2 = 6.36619772367581382433e-01, pio2_1 = 1.57079632673412561417e+00,
                pio2_1t = 6.07710050650619224932e-11, pio2_2 = 6.07710050630396597660e-11,
                pio2_2t = 2.02226624879595063154e-21, pio2_3 = 2.02226624871116645580e-21,
                pio2_3t = 8.47842766036889956997e-32;
            double z = 0, w, t, r, fn;
            int hx = High(x), ix = hx & 0x7FFFFFFF, n, i, j, e0, nx;
            if (ix <= 0x3FE921FB) { y[0] = x; y[1] = 0; return 0; }
            if (ix < 0x4002D97C)
            {
                if (hx > 0)
                {
                    z = x - pio2_1;
                    if (ix != 0x3FF921FB) { y[0] = z - pio2_1t; y[1] = (z - y[0]) - pio2_1t; }
                    else { z -= pio2_2; y[0] = z - pio2_2t; y[1] = (z - y[0]) - pio2_2t; }
                    return 1;
                }
                z = x + pio2_1;
                if (ix != 0x3FF921FB) { y[0] = z + pio2_1t; y[1] = (z - y[0]) + pio2_1t; }
                else { z += pio2_2; y[0] = z + pio2_2t; y[1] = (z - y[0]) + pio2_2t; }
                return -1;
            }
            if (ix <= 0x413921FB)
            {
                t = Math.Abs(x);
                n = (int)(t * invpio2 + half);
                fn = n;
                r = t - fn * pio2_1;
                w = fn * pio2_1t;
                if (n < 32 && ix != NPio2Hw[n - 1]) y[0] = r - w;
                else
                {
                    j = ix >> 20;
                    y[0] = r - w;
                    i = j - (int)(((uint)High(y[0]) >> 20) & 0x7FF);
                    if (i > 16)
                    {
                        t = r; w = fn * pio2_2; r = t - w; w = fn * pio2_2t - ((t - r) - w); y[0] = r - w;
                        i = j - (int)(((uint)High(y[0]) >> 20) & 0x7FF);
                        if (i > 49) { t = r; w = fn * pio2_3; r = t - w; w = fn * pio2_3t - ((t - r) - w); y[0] = r - w; }
                    }
                }
                y[1] = (r - y[0]) - w;
                if (hx < 0) { y[0] = -y[0]; y[1] = -y[1]; return -n; }
                return n;
            }
            if (ix >= 0x7FF00000) { y[0] = y[1] = x - x; return 0; }
            z = WithLow(z, Low(x));
            e0 = (ix >> 20) - 1046;
            z = WithHigh(z, ix - (int)((uint)e0 << 20));
            var tx = new double[3];
            for (i = 0; i < 2; i++) { tx[i] = (int)z; z = (z - tx[i]) * two24; }
            tx[2] = z;
            nx = 3;
            while (tx[nx - 1] == 0.0) nx--;
            n = KernelRemPio2(tx, y, e0, nx, 2, TwoOverPi);
            if (hx < 0) { y[0] = -y[0]; y[1] = -y[1]; return -n; }
            return n;
        }

        static readonly int[] InitJk = { 2, 3, 4, 6 };
        static readonly double[] PIo2 = {
            1.57079625129699707031e+00, 7.54978941586159635335e-08, 5.39030252995776476554e-15,
            3.28200341580791294123e-22, 1.27065575308067607349e-29, 1.22933308981111328932e-36,
            2.73370053816464559624e-44, 2.16741683877804819444e-51,
        };

        static int KernelRemPio2(double[] x, double[] y, int e0, int nx, int prec, int[] ipio2)
        {
            const double two24 = 1.67772160000000000000e+07, twon24 = 5.96046447753906250000e-08;
            int jz, jx, jv, jp, jk, carry, n, i, j, k, m, q0, ih;
            var iq = new int[20]; var f = new double[20]; var fq = new double[20]; var q = new double[20];
            double z, fw;
            jk = InitJk[prec]; jp = jk;
            jx = nx - 1;
            jv = (e0 - 3) / 24; if (jv < 0) jv = 0;
            q0 = e0 - 24 * (jv + 1);
            j = jv - jx; m = jx + jk;
            for (i = 0; i <= m; i++, j++) f[i] = j < 0 ? 0.0 : ipio2[j];
            for (i = 0; i <= jk; i++) { for (j = 0, fw = 0.0; j <= jx; j++) fw += x[j] * f[jx + i - j]; q[i] = fw; }
            jz = jk;
            while (true)
            {
                for (i = 0, j = jz, z = q[jz]; j > 0; i++, j--)
                {
                    fw = (int)(twon24 * z);
                    iq[i] = (int)(z - two24 * fw);
                    z = q[j - 1] + fw;
                }
                z = ScaleB(z, q0);
                z -= 8.0 * Math.Floor(z * 0.125);
                n = (int)z;
                z -= n;
                ih = 0;
                if (q0 > 0) { i = iq[jz - 1] >> (24 - q0); n += i; iq[jz - 1] -= i << (24 - q0); ih = iq[jz - 1] >> (23 - q0); }
                else if (q0 == 0) ih = iq[jz - 1] >> 23;
                else if (z >= 0.5) ih = 2;
                if (ih > 0)
                {
                    n += 1; carry = 0;
                    for (i = 0; i < jz; i++)
                    {
                        j = iq[i];
                        if (carry == 0) { if (j != 0) { carry = 1; iq[i] = 0x1000000 - j; } }
                        else iq[i] = 0xFFFFFF - j;
                    }
                    if (q0 > 0)
                    {
                        if (q0 == 1) iq[jz - 1] &= 0x7FFFFF;
                        else if (q0 == 2) iq[jz - 1] &= 0x3FFFFF;
                    }
                    if (ih == 2) { z = 1.0 - z; if (carry != 0) z -= ScaleB(1.0, q0); }
                }
                if (z == 0.0)
                {
                    j = 0;
                    for (i = jz - 1; i >= jk; i--) j |= iq[i];
                    if (j == 0)
                    {
                        for (k = 1; jk >= k && iq[jk - k] == 0; k++) { }
                        for (i = jz + 1; i <= jz + k; i++)
                        {
                            f[jx + i] = ipio2[jv + i];
                            for (j = 0, fw = 0.0; j <= jx; j++) fw += x[j] * f[jx + i - j];
                            q[i] = fw;
                        }
                        jz += k;
                        continue;
                    }
                }
                break;
            }
            if (z == 0.0)
            {
                jz -= 1; q0 -= 24;
                while (iq[jz] == 0) { jz--; q0 -= 24; }
            }
            else
            {
                z = ScaleB(z, -q0);
                if (z >= two24)
                {
                    fw = (int)(twon24 * z);
                    iq[jz] = (int)(z - two24 * fw);
                    jz += 1; q0 += 24;
                    iq[jz] = (int)fw;
                }
                else iq[jz] = (int)z;
            }
            fw = ScaleB(1.0, q0);
            for (i = jz; i >= 0; i--) { q[i] = fw * iq[i]; fw *= twon24; }
            for (i = jz; i >= 0; i--)
            {
                for (fw = 0.0, k = 0; k <= jp && k <= jz - i; k++) fw += PIo2[k] * q[i + k];
                fq[jz - i] = fw;
            }
            // prec is always 2 here.
            fw = 0.0;
            for (i = jz; i >= 0; i--) fw += fq[i];
            y[0] = ih == 0 ? fw : -fw;
            fw = fq[0] - fw;
            for (i = 1; i <= jz; i++) fw += fq[i];
            y[1] = ih == 0 ? fw : -fw;
            return n & 7;
        }

        static double KernelCos(double x, double y)
        {
            const double one = 1.0, C1 = 4.16666666666666019037e-02, C2 = -1.38888888888741095749e-03,
                C3 = 2.48015872894767294178e-05, C4 = -2.75573143513906633035e-07,
                C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11;
            int ix = High(x) & 0x7FFFFFFF;
            if (ix < 0x3E400000 && (int)x == 0) return one;
            double z = x * x;
            double r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
            if (ix < 0x3FD33333) return one - (0.5 * z - (z * r - x * y));
            double qx = ix > 0x3FE90000 ? 0.28125 : Words(ix - 0x00200000, 0);
            double iz = 0.5 * z - qx, a = one - qx;
            return a - (iz - (z * r - x * y));
        }

        static double KernelSin(double x, double y, int iy)
        {
            const double half = 5.00000000000000000000e-01, S1 = -1.66666666666666324348e-01,
                S2 = 8.33333333332248946124e-03, S3 = -1.98412698298579493134e-04,
                S4 = 2.75573137070700676789e-06, S5 = -2.50507602534068634195e-08,
                S6 = 1.58969099521155010221e-10;
            int ix = High(x) & 0x7FFFFFFF;
            if (ix < 0x3E400000 && (int)x == 0) return x;
            double z = x * x, v = z * x, r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
            if (iy == 0) return x + v * (S1 + z * r);
            return x - ((z * (half * y - v * r) - y) - v * S1);
        }

        public static double Sin(double x)
        {
            int ix = High(x) & 0x7FFFFFFF;
            if (ix <= 0x3FE921FB) return KernelSin(x, 0.0, 0);
            if (ix >= 0x7FF00000) return x - x;
            var y = new double[2];
            switch (RemPio2(x, y) & 3)
            {
                case 0: return KernelSin(y[0], y[1], 1);
                case 1: return KernelCos(y[0], y[1]);
                case 2: return -KernelSin(y[0], y[1], 1);
                default: return -KernelCos(y[0], y[1]);
            }
        }

        public static double Cos(double x)
        {
            int ix = High(x) & 0x7FFFFFFF;
            if (ix <= 0x3FE921FB) return KernelCos(x, 0.0);
            if (ix >= 0x7FF00000) return x - x;
            var y = new double[2];
            switch (RemPio2(x, y) & 3)
            {
                case 0: return KernelCos(y[0], y[1]);
                case 1: return -KernelSin(y[0], y[1], 1);
                case 2: return -KernelCos(y[0], y[1]);
                default: return KernelSin(y[0], y[1], 1);
            }
        }

        public static double Exp(double x)
        {
            const double one = 1.0, o_threshold = 7.09782712893383973096e+02, u_threshold = -7.45133219101941108420e+02,
                invln2 = 1.44269504088896338700e+00, P1 = 1.66666666666666019037e-01,
                P2 = -2.77777777770155933842e-03, P3 = 6.61375632143793436117e-05,
                P4 = -1.65339022054652515390e-06, P5 = 4.13813679705723846039e-08, E = 2.718281828459045,
                huge = 1.0e+300, twom1000 = 9.33263618503218878990e-302, two1023 = 8.988465674311579539e307;
            double[] halF = { 0.5, -0.5 }, ln2HI = { 6.93147180369123816490e-01, -6.93147180369123816490e-01 },
                ln2LO = { 1.90821492927058770002e-10, -1.90821492927058770002e-10 };
            double y, hi = 0.0, lo = 0.0, c, t, twopk;
            int k = 0;
            uint hx = (uint)High(x);
            int xsb = (int)((hx >> 31) & 1);
            hx &= 0x7FFFFFFF;
            if (hx >= 0x40862E42)
            {
                if (hx >= 0x7FF00000)
                {
                    if (((hx & 0xFFFFF) | Low(x)) != 0) return x + x;
                    return xsb == 0 ? x : 0.0;
                }
                if (x > o_threshold) return huge * huge;
                if (x < u_threshold) return twom1000 * twom1000;
            }
            if (hx > 0x3FD62E42)
            {
                if (hx < 0x3FF0A2B2)
                {
                    if (x == 1.0) return E;
                    hi = x - ln2HI[xsb]; lo = ln2LO[xsb]; k = 1 - xsb - xsb;
                }
                else
                {
                    k = (int)(invln2 * x + halF[xsb]);
                    t = k;
                    hi = x - t * ln2HI[0];
                    lo = t * ln2LO[0];
                }
                x = hi - lo;
            }
            else if (hx < 0x3E300000)
            {
                if (huge + x > one) return one + x;
            }
            else k = 0;
            t = x * x;
            twopk = k >= -1021 ? Words(0x3FF00000 + (int)((uint)k << 20), 0) : Words(0x3FF00000 + (int)((uint)(k + 1000) << 20), 0);
            c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
            if (k == 0) return one - ((x * c) / (c - 2.0) - x);
            y = one - ((lo - (x * c) / (2.0 - c)) - hi);
            if (k >= -1021)
            {
                if (k == 1024) return y * 2.0 * two1023;
                return y * twopk;
            }
            return y * twopk * twom1000;
        }

        static readonly double[] AtanHi = { 4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00 };
        static readonly double[] AtanLo = { 2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17 };
        static readonly double[] AT = {
            3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01,
            -1.11111104054623557880e-01, 9.09088713343650656196e-02, -7.69187620504482999495e-02,
            6.66107313738753120669e-02, -5.83357013379057348645e-02, 4.97687799461593236017e-02,
            -3.65315727442169155270e-02, 1.62858201153657823623e-02,
        };

        public static double Atan(double x)
        {
            const double one = 1.0, huge = 1.0e300;
            int hx = High(x), ix = hx & 0x7FFFFFFF, id;
            if (ix >= 0x44100000)
            {
                if (ix > 0x7FF00000 || (ix == 0x7FF00000 && Low(x) != 0)) return x + x;
                return hx > 0 ? AtanHi[3] + AtanLo[3] : -AtanHi[3] - AtanLo[3];
            }
            if (ix < 0x3FDC0000)
            {
                if (ix < 0x3E400000 && huge + x > one) return x;
                id = -1;
            }
            else
            {
                x = Math.Abs(x);
                if (ix < 0x3FF30000)
                {
                    if (ix < 0x3FE60000) { id = 0; x = (2.0 * x - one) / (2.0 + x); }
                    else { id = 1; x = (x - one) / (x + one); }
                }
                else if (ix < 0x40038000) { id = 2; x = (x - 1.5) / (one + 1.5 * x); }
                else { id = 3; x = -1.0 / x; }
            }
            double z = x * x, w = z * z;
            double s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
            double s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
            if (id < 0) return x - x * (s1 + s2);
            z = AtanHi[id] - ((x * (s1 + s2) - AtanLo[id]) - x);
            return hx < 0 ? -z : z;
        }

        public static double Atan2(double y, double x)
        {
            const double tiny = 1.0e-300, pi_o_4 = 7.8539816339744827900E-01, pi_o_2 = 1.5707963267948965580E+00,
                pi = 3.1415926535897931160E+00, pi_lo = 1.2246467991473531772E-16;
            double z;
            int hx = High(x), ix = hx & 0x7FFFFFFF, hy = High(y), iy = hy & 0x7FFFFFFF, k, m;
            uint lx = Low(x), ly = Low(y);
            if ((ix | (int)((lx | (uint)(-(int)lx)) >> 31)) > 0x7FF00000 || (iy | (int)((ly | (uint)(-(int)ly)) >> 31)) > 0x7FF00000) return x + y;
            if (((hx - 0x3FF00000) | (int)lx) == 0) return Atan(y);
            m = ((hy >> 31) & 1) | ((hx >> 30) & 2);
            if ((iy | (int)ly) == 0)
            {
                switch (m) { case 0: case 1: return y; case 2: return pi + tiny; default: return -pi - tiny; }
            }
            if ((ix | (int)lx) == 0) return hy < 0 ? -pi_o_2 - tiny : pi_o_2 + tiny;
            if (ix == 0x7FF00000)
            {
                if (iy == 0x7FF00000)
                    switch (m) { case 0: return pi_o_4 + tiny; case 1: return -pi_o_4 - tiny; case 2: return 3.0 * pi_o_4 + tiny; default: return -3.0 * pi_o_4 - tiny; }
                switch (m) { case 0: return 0.0; case 1: return -0.0; case 2: return pi + tiny; default: return -pi - tiny; }
            }
            if (iy == 0x7FF00000) return hy < 0 ? -pi_o_2 - tiny : pi_o_2 + tiny;
            k = (iy - ix) >> 20;
            if (k > 60) { z = pi_o_2 + 0.5 * pi_lo; m &= 1; }
            else if (hx < 0 && k < -60) z = 0.0;
            else z = Atan(Math.Abs(y / x));
            switch (m)
            {
                case 0: return z;
                case 1: return -z;
                case 2: return pi - (z - pi_lo);
                default: return (z - pi_lo) - pi;
            }
        }

        /// <summary>V8 Math.hypot: normalise by the largest magnitude, Kahan-sum squares.</summary>
        public static double Hypot(double a, double b) => Hypot3(a, b, 0.0, 2);
        public static double Hypot(double a, double b, double c) => Hypot3(a, b, c, 3);
        static double Hypot3(double a, double b, double c, int length)
        {
            bool nan = false; double max = 0;
            double aa = Math.Abs(a), ab = Math.Abs(b), ac = Math.Abs(c);
            if (double.IsNaN(a)) nan = true; else if (aa > max) max = aa;
            if (double.IsNaN(b)) nan = true; else if (ab > max) max = ab;
            if (length == 3) { if (double.IsNaN(c)) nan = true; else if (ac > max) max = ac; }
            if (double.IsPositiveInfinity(max)) return double.PositiveInfinity;
            if (nan) return double.NaN;
            if (max == 0) return 0;
            double sum = 0, compensation = 0;
            void Add(double v) { double n = v / max, summand = n * n - compensation, preliminary = sum + summand; compensation = (preliminary - sum) - summand; sum = preliminary; }
            Add(aa); Add(ab); if (length == 3) Add(ac);
            return Math.Sqrt(sum) * max;
        }
        public static double Hypot(params double[] values)
        {
            bool nan = false; double max = 0;
            foreach (var v in values) { if (double.IsNaN(v)) nan = true; else if (Math.Abs(v) > max) max = Math.Abs(v); }
            if (double.IsPositiveInfinity(max)) return double.PositiveInfinity;
            if (nan) return double.NaN;
            if (max == 0) return 0;
            double sum = 0, compensation = 0;
            foreach (var v in values) { double n = Math.Abs(v) / max, summand = n * n - compensation, preliminary = sum + summand; compensation = (preliminary - sum) - summand; sum = preliminary; }
            return Math.Sqrt(sum) * max;
        }

        /// <summary>ECMAScript Math.round: ties toward +Infinity; -0.4 gives -0.</summary>
        public static double Round(double x)
        {
            if (double.IsNaN(x) || double.IsInfinity(x)) return x;
            double r = Math.Ceiling(x);
            if (r - 0.5 > x) r -= 1.0;
            return r;
        }

        /// <summary>ECMAScript Math.max/min for two numbers (NaN wins; +0 &gt; -0).</summary>
        public static double Max(double a, double b)
        {
            if (double.IsNaN(a) || double.IsNaN(b)) return double.NaN;
            if (a == b && a == 0) return IsNegativeZero(a) ? b : a;
            return a > b ? a : b;
        }
        public static double Min(double a, double b)
        {
            if (double.IsNaN(a) || double.IsNaN(b)) return double.NaN;
            if (a == b && a == 0) return IsNegativeZero(a) ? a : b;
            return a < b ? a : b;
        }
        public static double Max(params double[] values) { double r = double.NegativeInfinity; foreach (var v in values) r = Max(r, v); return r; }
        public static double Min(params double[] values) { double r = double.PositiveInfinity; foreach (var v in values) r = Min(r, v); return r; }
        public static bool IsNegativeZero(double v) => v == 0 && BitConverter.DoubleToInt64Bits(v) < 0;

        /// <summary>ECMAScript ToInt32 (used by |0, &gt;&gt;, &amp;, Math.imul).</summary>
        public static int ToInt32(double v)
        {
            if (double.IsNaN(v) || double.IsInfinity(v)) return 0;
            double t = Math.Truncate(v), m = t % 4294967296.0;
            if (m < 0) m += 4294967296.0;
            return unchecked((int)(uint)m);
        }
        /// <summary>ECMAScript ToUint32 (used by x &gt;&gt;&gt; 0).</summary>
        public static uint ToUint32(double v) => unchecked((uint)ToInt32(v));
        public static int Imul(int a, int b) => unchecked(a * b);

        /// <summary>ECMAScript Number::toString(10): shortest round-trip digits.</summary>
        public static string ToJsString(double v)
        {
            if (double.IsNaN(v)) return "NaN";
            if (v == 0) return "0";
            if (double.IsInfinity(v)) return v > 0 ? "Infinity" : "-Infinity";
            if (v < 0) return "-" + ToJsString(-v);
            // "R" on .NET Core 3+/Mono 6+ yields the shortest round-trip digits.
            string shortest = v.ToString("R", CultureInfo.InvariantCulture);
            // Normalise to digits + exponent: d.ddddE+xxx
            string digits; int exponent;
            int ePos = shortest.IndexOfAny(new[] { 'E', 'e' });
            string mantissa = ePos >= 0 ? shortest.Substring(0, ePos) : shortest;
            int exp10 = ePos >= 0 ? int.Parse(shortest.Substring(ePos + 1), CultureInfo.InvariantCulture) : 0;
            int dot = mantissa.IndexOf('.');
            string intPart = dot >= 0 ? mantissa.Substring(0, dot) : mantissa, frac = dot >= 0 ? mantissa.Substring(dot + 1) : "";
            digits = (intPart + frac).TrimStart('0');
            int leadingZeros = (intPart + frac).Length - (intPart + frac).TrimStart('0').Length;
            exponent = intPart.Length - leadingZeros + exp10; // value = 0.digits × 10^exponent
            digits = digits.TrimEnd('0');
            if (digits.Length == 0) return "0";
            int k = digits.Length, n = exponent;
            if (k <= n && n <= 21) return digits + new string('0', n - k);
            if (0 < n && n <= 21) return digits.Substring(0, n) + "." + digits.Substring(n);
            if (-6 < n && n <= 0) return "0." + new string('0', -n) + digits;
            string e = (n - 1) >= 0 ? "+" + (n - 1).ToString(CultureInfo.InvariantCulture) : (n - 1).ToString(CultureInfo.InvariantCulture);
            return k == 1 ? digits + "e" + e : digits.Substring(0, 1) + "." + digits.Substring(1) + "e" + e;
        }
    }
}
