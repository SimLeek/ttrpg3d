using Godot;
using System;

public partial class WindGenerator : Node
{
	[Export] public AudioStreamPlayer Player;

	[ExportGroup("Main Wind Settings")]
	[Export] public float BaseIntensity = 0.2f;
	[Export] public float GustStrength = 0.2f;
	[Export] public float NoiseEvolutionSpeed = 1.0f; // Replaces the 100f multiplier
	[Export] public float NoiseFrequency = .15f;

	[ExportGroup("Whistle Settings")]
	[Export] public float WhistleVolume = 0.01f; // Keep it subtle
	[Export] public float WhistlePitchBase = 1500.0f; // Hz
	[Export] public float WhistleResonance = 0.98f; // 0.0 to 1.0 (Higher = sharper whistle)

	private AudioStreamGeneratorPlayback _playback;
	private FastNoiseLite _noise = new FastNoiseLite();
	private float _noiseTime = 0.0f;
	private Random _random = new Random();

	// Filter variables
	private float _prevMainSample = 0.0f;
	private float _b0, _b1, _b2; // Whistle filter state

	// Pink noise state (Voss-McCartney approximation)
	private float[] _pinkRows = new float[7];
	private float _pinkRunningSum = 0.0f;

	public override void _Ready()
	{
		_noise.Seed = (int)GD.Randi();
		_noise.Frequency = NoiseFrequency;

		if (Player.Stream is AudioStreamGenerator generator)
		{
			Player.Play();
			_playback = (AudioStreamGeneratorPlayback)Player.GetStreamPlayback();
		}
	}

	public override void _Process(double delta)
	{
		if (_playback != null)
		{
			_noiseTime += (float)delta * NoiseEvolutionSpeed;
			FillBuffer();
		}
	}

	private void FillBuffer()
	{
		int framesAvailable = _playback.GetFramesAvailable();
		float gustValue = (_noise.GetNoise1D(_noiseTime) + 1.0f) / 2.0f;

		float currentIntensity = BaseIntensity + (gustValue * GustStrength);
		
		// Dynamic Filter Cutoffs
		float mainCutoff = 0.001f + (gustValue * 0.02f);
		float whistleFreq = WhistlePitchBase + (gustValue * 1000.0f);

		for (int i = 0; i < framesAvailable; i++)
		{
			// 1. Generate Pink Noise (Much softer than White)
			float pink = GeneratePinkNoise();

			// 2. Main Wind: Deep Low-Pass
			float mainWind = (pink * mainCutoff) + (_prevMainSample * (1.0f - mainCutoff));
			_prevMainSample = mainWind;

			// 3. Whistle: Resonant Bandpass
			float whistle = ApplyWhistleFilter(pink, whistleFreq);

			// 4. Final Mix
			float finalSample = (mainWind * currentIntensity) + (whistle * WhistleVolume * currentIntensity);
			
			_playback.PushFrame(new Vector2(finalSample, finalSample));
		}
	}

	// A simple 1/f pink noise approximation
	private float GeneratePinkNoise()
	{
		float white = (float)(_random.NextDouble() * 2.0 - 1.0);
		int i = 0;
		while (i < 7)
		{
			if ((_random.Next() % (1 << i)) == 0)
			{
				_pinkRunningSum -= _pinkRows[i];
				_pinkRows[i] = (float)(_random.NextDouble() * 2.0 - 1.0) / (i + 1);
				_pinkRunningSum += _pinkRows[i];
				break;
			}
			i++;
		}
		return (_pinkRunningSum) * 0.5f;
	}

	// Simple IIR Bandpass for the whistle
	private float ApplyWhistleFilter(float input, float frequency)
	{
		float omega = (float)(2.0 * Math.PI * frequency / 44100.0);
		float sinW = (float)Math.Sin(omega);
		float cosW = (float)Math.Cos(omega);
		float alpha = sinW * (1.0f - WhistleResonance);

		float a0 = 1.0f + alpha;
		float b0 = alpha / a0;
		
		// This is a simplified state-variable feedback for a narrow peak
		_b2 = _b2 + omega * _b1;
		_b1 = _b1 + omega * (input - _b2 - WhistleResonance * _b1);
		
		return _b1;
	}
}
