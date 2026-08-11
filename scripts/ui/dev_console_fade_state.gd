extends RefCounted
class_name DevConsoleFadeState

## Pure, dependency-free fade math for the dev console UI: fully visible
## while focused, fades linearly to invisible over FADE_DURATION_MSEC after
## focus is lost, snaps back to fully visible the instant focus returns.
## compute_alpha() takes "now" as a parameter rather than calling
## Time.get_ticks_msec() itself, so this is exhaustively unit-testable via
## DevConsole's unit_fade_* commands (spoofed timestamps, no real waiting,
## no window/keyboard needed) instead of live/visual testing, which kept
## missing bugs here (an unrelated fade-on-any-log-activity design reset
## the timer on every stdout line project-wide, including the "prim"/"sec"
## prints two_handed_resource.gd does on every click -- looked like the
## console was "always on" and like clicking the screen re-focused it).

const FADE_DURATION_MSEC := 10000

var _unfocused_since_msec: int = -1

func compute_alpha(is_focused: bool, now_msec: int) -> float:
	if is_focused:
		_unfocused_since_msec = -1
		return 1.0
	if _unfocused_since_msec == -1:
		_unfocused_since_msec = now_msec
	var elapsed: int = now_msec - _unfocused_since_msec
	if elapsed <= 0:
		return 1.0
	return clamp(1.0 - float(elapsed) / float(FADE_DURATION_MSEC), 0.0, 1.0)
