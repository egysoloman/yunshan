// Warm pools of light on the ground under street and door lamps after dusk
// (web renderer buildGroundGlow): additive, radial (1 - r)^2 falloff, no depth write.
Shader "Yunshan/GroundGlow"
{
    Properties { _Night ("Night", Range(0, 1)) = 0 }
    SubShader
    {
        Tags { "Queue"="Transparent" "RenderType"="Transparent" "IgnoreProjector"="True" }
        Blend One One
        ZWrite Off
        Cull Off
        Offset -2, -2
        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"
            float _Night;
            struct appdata { float4 vertex : POSITION; float2 corner : TEXCOORD0; };
            struct v2f { float4 pos : SV_POSITION; float2 corner : TEXCOORD0; float fade : TEXCOORD1; };
            v2f vert (appdata v)
            {
                v2f o; float3 view = UnityObjectToViewPos(v.vertex.xyz);
                o.pos = mul(UNITY_MATRIX_P, float4(view, 1)); o.corner = v.corner; o.fade = 1.0 - smoothstep(180.0, 320.0, -view.z);
                return o;
            }
            fixed4 frag (v2f i) : SV_Target
            {
                float r = length(i.corner); if (r > 1.0) discard;
                float pool = pow(1.0 - r, 2.0);
                return fixed4(float3(1.0, .62, .3) * pool * .55 * _Night * i.fade, 1);
            }
            ENDCG
        }
    }
}
