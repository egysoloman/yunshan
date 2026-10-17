// Far lantern glow after dusk (web renderer buildLanternGlow): every glow is a
// screen-facing quad around its centre with an on-screen size of
// clamp(size × 400 / distance, 6, 18) pixels, so lanterns still read as points
// of warm light at drone distance. Additive, no depth write.
Shader "Yunshan/LanternGlow"
{
    Properties { _Night ("Night", Range(0, 1)) = 0 }
    SubShader
    {
        Tags { "Queue"="Transparent" "RenderType"="Transparent" "IgnoreProjector"="True" }
        Blend One One
        ZWrite Off
        Cull Off
        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"
            float _Night;
            // vertex: glow centre; uv: quad corner (−1…1); uv2.x: glow size.
            struct appdata { float4 vertex : POSITION; float2 corner : TEXCOORD0; float2 size : TEXCOORD1; };
            struct v2f { float4 pos : SV_POSITION; float2 corner : TEXCOORD0; float fade : TEXCOORD1; };
            v2f vert (appdata v)
            {
                v2f o; float3 view = UnityObjectToViewPos(v.vertex.xyz); float d = -view.z;
                o.pos = mul(UNITY_MATRIX_P, float4(view, 1));
                float pixels = clamp(v.size.x * 400.0 / max(d, 1.0), 6.0, 18.0);
                o.pos.xy += v.corner * pixels / _ScreenParams.xy * o.pos.w;
                o.corner = v.corner; o.fade = clamp(1.4 - d / 4200.0, .25, 1.0);
                return o;
            }
            fixed4 frag (v2f i) : SV_Target
            {
                float r = length(i.corner); if (r > 1.0) discard;
                float core = smoothstep(.42, .0, r), halo = pow(1.0 - r, 1.4);
                return fixed4(float3(1.0, .48, .14) * (core * 1.1 + halo * .7) * _Night * i.fade, 1);
            }
            ENDCG
        }
    }
}
