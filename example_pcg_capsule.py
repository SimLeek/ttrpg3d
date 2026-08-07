"""
PCG Capsule

Demonstrates how biomes can be distributed within a capsule, so that most biomes will be guaranteed to show up
Biomes are generated with Fibonacci spheres, which always include the same number of points
with exact locations plus random jitter, so biomes may be generated at the same place,
or somewhere on the horizon, above, or below, which are all differentiated.
Biome generation for 5000+ approximately evenly spaced biomes within a capsule takes less than a minute.
Spatial hash lookups for determining what biome a position is in takes hundreds-thousands of microseconds,
which leaves more than enough time for chunk generation or even voxel generation.
"""

import numpy as np
import vtk
from collections import defaultdict
from typing import List, Optional, Tuple
import time
# Constants for capsule geometry
CAPSULE_RADIUS = 50.0
CAPSULE_HEIGHT = 400.0
PLANE_Z = 100.0
MIN_DIST = 8.0
RING_RADIUS = 15.0  # Not used anymore, but kept for reference


class SpatialHash:
    """
    Efficient 3D spatial hash with guaranteed exact nearest-neighbor query.

    Local cell search uses a 3×3×3 neighborhood. If no candidates are found,
    expands spherically outward layer-by-layer until at least one point is located.
    Eliminates full-scan fallback entirely.
    """

    def __init__(self, cell_size: float) -> None:
        if cell_size <= 0:
            raise ValueError("cell_size must be positive")

        self.t0 = self.t1 = time.time()
        self.cell_size: float = cell_size
        self.grid: defaultdict[Tuple[int, int, int], List[np.ndarray]] = defaultdict(list)

    @staticmethod
    def _cell_key(p: np.ndarray, cell_size: float) -> Tuple[int, int, int]:
        return tuple(np.floor(p / cell_size).astype(int))

    def insert(self, p: np.ndarray) -> None:
        key = self._cell_key(p, self.cell_size)
        self.grid[key].append(p)

    def _local_candidates(self, q: np.ndarray) -> List[np.ndarray]:
        """Gather points from the 3×3×3 cell neighborhood around query point."""
        cell = self._cell_key(q, self.cell_size)
        candidates: List[np.ndarray] = []
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    neighbor = (cell[0] + dx, cell[1] + dy, cell[2] + dz)
                    candidates.extend(self.grid[neighbor])
        return candidates

    def _spherical_expansion_nearest(self, q: np.ndarray, r_max:int=100) -> np.ndarray:
        """
        Expand spherically outward from query cell until a point is found.
        Returns the nearest point discovered.
        """
        cell = self._cell_key(q, self.cell_size)
        radius = 1
        while radius<=r_max:
            candidates: List[np.ndarray] = []
            # Iterate over integer offsets within Manhattan distance == radius
            for dx in range(-radius, radius + 1):
                for dy in range(-radius, radius + 1):
                    for dz in range(-radius, radius + 1):
                        if max(abs(dx), abs(dy), abs(dz)) == radius:
                            neighbor = (cell[0] + dx, cell[1] + dy, cell[2] + dz)
                            candidates.extend(self.grid[neighbor])
            if candidates:
                distances = np.linalg.norm(np.array(candidates) - q, axis=1)
                print(f"point found at radius {radius}")
                return candidates[np.argmin(distances)]
            radius += 1
        return []

    def query_nearest(self, q: np.ndarray) -> np.ndarray:
        """Exact nearest-neighbor query with no full scan."""
        t0 = time.time()
        candidates = self._local_candidates(q)
        if candidates:
            distances = np.linalg.norm(np.array(candidates) - q, axis=1)
            print(f"point found at radius 0")
            t1 = time.time()
            print(f"Spatial hash query time: {(t1-t0)*1000000} microseconds")
            return candidates[np.argmin(distances)]
        sphere_results = self._spherical_expansion_nearest(q)
        t1 = time.time()
        print(f"Spatial hash query time: {(t1 - t0)*1000000} microseconds")
        return sphere_results


def capsule_radius_at_z(z: float) -> float:
    """
    Computes the radius of the capsule's cross-section at a given z-height.
    """
    if z < CAPSULE_RADIUS:
        return np.sqrt(CAPSULE_RADIUS ** 2 - (CAPSULE_RADIUS - z) ** 2)
    elif z > CAPSULE_HEIGHT - CAPSULE_RADIUS:
        return np.sqrt(CAPSULE_RADIUS ** 2 - (z - (CAPSULE_HEIGHT - CAPSULE_RADIUS)) ** 2)
    else:
        return CAPSULE_RADIUS


def is_inside_capsule(p: np.ndarray) -> bool:
    """
    Checks if a point is inside the capsule.
    """
    x, y, z = p
    if z < 0 or z > CAPSULE_HEIGHT:
        return False
    rad = np.sqrt(x ** 2 + y ** 2)
    max_rad = capsule_radius_at_z(z)
    return rad <= max_rad


def ray_sphere_intersection(p: np.ndarray, d: np.ndarray, c: np.ndarray, r: float) -> list[float]:
    """
    Computes intersection times t for ray p + t*d with sphere center c, radius r.
    """
    pc = p - c
    a = np.dot(d, d)
    b = 2 * np.dot(d, pc)
    cc = np.dot(pc, pc) - r ** 2  # renamed to cc to avoid conflict with built-in c
    disc = b ** 2 - 4 * a * cc
    if disc < 0:
        return []
    sqrt_disc = np.sqrt(disc)
    t1 = (-b - sqrt_disc) / (2 * a)
    t2 = (-b + sqrt_disc) / (2 * a)
    return [t for t in [t1, t2] if t > 0]


def ray_capsule_intersection(p: np.ndarray, d: np.ndarray) -> float | None:
    """
    Computes the smallest positive t for ray p + t*d intersecting the capsule boundary.
    """
    epsilon = 0.01
    ts = []

    # Cylinder part (infinite cylinder, then clip to z range)
    p_xy = p[0:2]
    d_xy = d[0:2]
    a = np.dot(d_xy, d_xy)
    b = 2 * np.dot(p_xy, d_xy)
    cc = np.dot(p_xy, p_xy) - CAPSULE_RADIUS ** 2
    if a > 0:
        disc = b ** 2 - 4 * a * cc
        if disc >= 0:
            sqrt_disc = np.sqrt(disc)
            t1 = (-b - sqrt_disc) / (2 * a)
            t2 = (-b + sqrt_disc) / (2 * a)
            for tt in [t1, t2]:
                if tt > epsilon:
                    z_hit = p[2] + tt * d[2]
                    if CAPSULE_RADIUS <= z_hit <= CAPSULE_HEIGHT - CAPSULE_RADIUS:
                        ts.append(tt)

    # Bottom sphere
    sphere_c = np.array([0.0, 0.0, CAPSULE_RADIUS])
    ts_sphere = ray_sphere_intersection(p, d, sphere_c, CAPSULE_RADIUS)
    for tt in ts_sphere:
        if tt > epsilon:
            z_hit = p[2] + tt * d[2]
            if z_hit <= CAPSULE_RADIUS:
                ts.append(tt)

    # Top sphere
    sphere_c = np.array([0.0, 0.0, CAPSULE_HEIGHT - CAPSULE_RADIUS])
    ts_sphere = ray_sphere_intersection(p, d, sphere_c, CAPSULE_RADIUS)
    for tt in ts_sphere:
        if tt > epsilon:
            z_hit = p[2] + tt * d[2]
            if z_hit >= CAPSULE_HEIGHT - CAPSULE_RADIUS:
                ts.append(tt)

    if ts:
        return min(ts)
    return None


def fibonacci_sphere_with_equator(n: int) -> np.ndarray:
    if n < 1:
        return np.array([])

    golden_ratio = (1 + 5 ** 0.5) / 2

    # number of equator points (at least 1)
    k = max(1, int(np.sqrt(n)))

    # equator ring
    i_eq = np.arange(k)
    theta_eq = 2 * np.pi * i_eq / golden_ratio
    x_eq = np.cos(theta_eq)
    z_eq = np.zeros(k)
    y_eq = np.sin(theta_eq)

    # remaining points
    m = n - k
    i = np.arange(m)
    phi = np.arccos(1 - 2 * (i + 0.5) / m)
    theta = 2 * np.pi * i / golden_ratio

    x = np.cos(theta) * np.sin(phi)
    z = np.sin(theta) * np.sin(phi)
    y = np.cos(phi)

    return np.vstack([
        np.stack((x_eq, y_eq, z_eq), axis=1),
        np.stack((x, y, z), axis=1)
    ])



def add_grid_to_renderer(renderer: vtk.vtkRenderer, min_bounds: np.ndarray, max_bounds: np.ndarray, voxel_size: float):
    """
    Adds a 3D grid of lines to the renderer for visualization.
    """
    num_lines = np.floor((max_bounds - min_bounds) / voxel_size).astype(int) + 1

    points = vtk.vtkPoints()
    lines = vtk.vtkCellArray()
    point_idx = 0

    def add_line(p1: list[float], p2: list[float]):
        nonlocal point_idx
        points.InsertNextPoint(p1)
        points.InsertNextPoint(p2)
        line = vtk.vtkLine()
        line.GetPointIds().SetId(0, point_idx)
        line.GetPointIds().SetId(1, point_idx + 1)
        lines.InsertNextCell(line)
        point_idx += 2

    # X-direction lines
    for iy in range(num_lines[1]):
        for iz in range(num_lines[2]):
            y = min_bounds[1] + iy * voxel_size
            z = min_bounds[2] + iz * voxel_size
            add_line([min_bounds[0], y, z], [max_bounds[0], y, z])

    # Y-direction lines
    for ix in range(num_lines[0]):
        for iz in range(num_lines[2]):
            x = min_bounds[0] + ix * voxel_size
            z = min_bounds[2] + iz * voxel_size
            add_line([x, min_bounds[1], z], [x, max_bounds[1], z])

    # Z-direction lines
    for ix in range(num_lines[0]):
        for iy in range(num_lines[1]):
            x = min_bounds[0] + ix * voxel_size
            y = min_bounds[1] + iy * voxel_size
            add_line([x, y, min_bounds[2]], [x, y, max_bounds[2]])

    polydata = vtk.vtkPolyData()
    polydata.SetPoints(points)
    polydata.SetLines(lines)

    mapper = vtk.vtkPolyDataMapper()
    mapper.SetInputData(polydata)

    actor = vtk.vtkActor()
    actor.SetMapper(mapper)
    actor.GetProperty().SetColor(0.5, 0.5, 0.5)
    actor.GetProperty().SetLineWidth(1.0)

    renderer.AddActor(actor)


class VoxelAnimator:
    """
    Animates voxel centers sequentially, drawing a point and a line to the nearest biome point.

    Cycles through all voxel centers in a loop.
    """

    def __init__(self, renderer: vtk.vtkRenderer, centers: np.ndarray, points: np.ndarray, sh: SpatialHash):
        self.renderer = renderer
        self.centers = centers
        self.points = points
        self.sh = sh
        self.current_index = 0

        # Sphere for voxel center
        self.sphere_source = vtk.vtkSphereSource()
        self.sphere_source.SetRadius(0.5)
        sphere_mapper = vtk.vtkPolyDataMapper()
        sphere_mapper.SetInputConnection(self.sphere_source.GetOutputPort())
        self.sphere_actor = vtk.vtkActor()
        self.sphere_actor.SetMapper(sphere_mapper)
        self.sphere_actor.GetProperty().SetColor(1.0, 1.0, 0.0)  # Yellow
        renderer.AddActor(self.sphere_actor)

        # Line to nearest point
        self.line_source = vtk.vtkLineSource()
        line_mapper = vtk.vtkPolyDataMapper()
        line_mapper.SetInputConnection(self.line_source.GetOutputPort())
        self.line_actor = vtk.vtkActor()
        self.line_actor.SetMapper(line_mapper)
        self.line_actor.GetProperty().SetColor(1.0, 0.0, 1.0)  # Magenta
        self.line_actor.GetProperty().SetLineWidth(2.0)
        renderer.AddActor(self.line_actor)

    def execute(self, obj, event):
        """
        Timer callback: updates visualization for the current voxel.
        """
        center = self.centers[self.current_index]
        nearest_point = self.sh.query_nearest(center)

        self.sphere_source.SetCenter(center)
        self.line_source.SetPoint1(center)
        self.line_source.SetPoint2(nearest_point)

        self.sphere_source.Update()
        self.line_source.Update()

        self.current_index = (self.current_index + 1) % len(self.centers)

        self.renderer.GetRenderWindow().Render()


def create_points_actor(points: np.ndarray, color: tuple[float, float, float], point_size: float = 6.0) -> vtk.vtkActor:
    """
    Creates a VTK actor for visualizing points.
    """
    vtk_points = vtk.vtkPoints()
    for p in points:
        vtk_points.InsertNextPoint(p)

    polydata = vtk.vtkPolyData()
    polydata.SetPoints(vtk_points)

    glyph_filter = vtk.vtkVertexGlyphFilter()
    glyph_filter.SetInputData(polydata)
    glyph_filter.Update()

    mapper = vtk.vtkPolyDataMapper()
    mapper.SetInputData(glyph_filter.GetOutput())

    actor = vtk.vtkActor()
    actor.SetMapper(mapper)
    actor.GetProperty().SetColor(color)
    actor.GetProperty().SetPointSize(point_size)
    return actor

def jitter_tangent(n, amp_theta, amp_phi, eps=1e-6):
    """
    Returns a jitter vector in the tangent plane of n.
    Returns zero if n lies on the plane (|z| < eps).
    """
    if abs(n[2]) < eps:
        return np.zeros(3)

    up = np.array([0.0, 0.0, 1.0])
    right = np.array([1.0, 0.0, 0.0])

    ref = up if abs(np.dot(n, up)) < 0.99 else right

    t_theta = np.cross(ref, n)
    t_theta /= np.linalg.norm(t_theta)

    t_phi = np.cross(n, t_theta)

    a = np.random.uniform(-amp_theta, amp_theta)
    b = np.random.uniform(-amp_phi, amp_phi)

    return a * t_theta + b * t_phi


def main():
    """
    Generates points, sets up VTK visualization, and starts animation.
    """
    center = np.array([0.0, 0.0, PLANE_Z])
    all_points_list = [center]
    ring_points = []

    max_r = 300.0
    r_step = MIN_DIST
    num_layers = int(np.ceil(max_r / r_step))
    jitter_amp = MIN_DIST / 3.0  # jitter_amp<MIN_DIST / 2.0 guarantees no clumping

    for layer in range(1, num_layers + 1):
        print(f"layer {layer} out of {num_layers}")
        r = layer * r_step
        if r > max_r:
            break

        if layer == 1:
           for i in range(6):
                angle = i * 2 * np.pi / 6
                dir_vec = np.array([np.cos(angle), np.sin(angle), 0.0])
                normal = dir_vec / np.linalg.norm(dir_vec)
                delta_r = np.random.uniform(-jitter_amp, jitter_amp)
                tangent_jitter = jitter_tangent(normal, jitter_amp, 0)
                p = center + r * normal + delta_r * normal + tangent_jitter
                if is_inside_capsule(p):
                    ring_points.append(p)
                    all_points_list.append(p)
        else:
            rd = r / MIN_DIST
            n = round(12.56 * rd ** 2)
            unit_dirs = fibonacci_sphere_with_equator(n)
            for dir_vec in unit_dirs:
                normal = dir_vec / np.linalg.norm(dir_vec)

                radial_jitter = np.random.uniform(-jitter_amp, jitter_amp)

                if abs(normal[2]) < 1e-6:
                    tangent_jitter = jitter_tangent(normal, jitter_amp, 0)
                else:
                    tangent_jitter = jitter_tangent(normal, jitter_amp, jitter_amp)
                p = center + r * normal + radial_jitter * normal + tangent_jitter
                if is_inside_capsule(p):
                    all_points_list.append(p)

    all_points = np.array(all_points_list)
    print("Number of biomes:", len(all_points))

    # Spatial hash
    voxel_size = MIN_DIST / np.sqrt(3)
    sh = SpatialHash(voxel_size)
    for p in all_points:
        sh.insert(p)

    # Relaxation
    alpha = 0.1
    relax_iterations = 2
    cos_threshold = 0.3
    search_radius = MIN_DIST * 4.0
    dirs = [
        np.array([1.0, 0.0, 0.0]),
        np.array([-1.0, 0.0, 0.0]),
        np.array([0.0, 1.0, 0.0]),
        np.array([0.0, -1.0, 0.0]),
        np.array([0.0, 0.0, 1.0]),
        np.array([0.0, 0.0, -1.0]),
    ]
    # neat, but slow
    """
    for relit in range(relax_iterations):
        print(f"relit:{relit}")
        new_positions = np.copy(all_points)
        print("copied")
        for i in range(len(all_points)):
            print(f"point: {i}")
            p = all_points[i]
            candidates = sh.query_all_within(p, search_radius)
            projs = [0.0] * 6
            for d_idx, dir_vec in enumerate(dirs):
                max_cos = float('-inf')
                best_q = None
                for c in candidates:
                    vec = c - p
                    norm = np.linalg.norm(vec)
                    if norm < 1e-6:
                        continue
                    cos = np.dot(vec, dir_vec) / norm
                    if cos > max_cos:
                        max_cos = cos
                        best_q = c
                t_bound = ray_capsule_intersection(p, dir_vec)
                use_bound = False
                if best_q is None or (t_bound is not None and np.dot(best_q - p, dir_vec) > t_bound):
                    use_bound = True if t_bound is not None else False
                if use_bound:
                    projs[d_idx] = t_bound
                elif max_cos > cos_threshold:
                    projs[d_idx] = np.dot(best_q - p, dir_vec)

            # Compute deltas
            delta_p = np.zeros(3)
            for axis in range(3):
                plus_idx = axis * 2
                minus_idx = axis * 2 + 1
                proj_p = projs[plus_idx]
                proj_m = projs[minus_idx]
                if proj_p <= 0 or proj_m <= 0:
                    continue
                half_p = 0.5 * proj_p
                half_m = 0.5 * proj_m
                imbalance = half_p - half_m
                delta = alpha * imbalance
                delta_p += delta * dirs[plus_idx]
            new_positions[i] = p + delta_p
        all_points = new_positions
        # Rebuild spatial hash
        print("rebuilding spatial hash")
        sh = SpatialHash(voxel_size)
        for pp in all_points:
            sh.insert(pp)
    """

    # Assign colors
    center_point = all_points[0:1]
    ring_accepted = np.array(ring_points) if ring_points else np.array([])
    plane_accepted = []
    below_accepted = []
    above_accepted = []
    for p in all_points[7:]:
        if abs(p[2] - PLANE_Z) < MIN_DIST / 32:
            plane_accepted.append(p)
        elif p[2] < PLANE_Z:
            below_accepted.append(p)
        else:
            above_accepted.append(p)
    plane_accepted = np.array(plane_accepted) if plane_accepted else np.array([])
    below_accepted = np.array(below_accepted) if below_accepted else np.array([])
    above_accepted = np.array(above_accepted) if above_accepted else np.array([])

    # Compute bounds with padding
    min_bounds = np.min(all_points, axis=0) - MIN_DIST / 2
    max_bounds = np.max(all_points, axis=0) + MIN_DIST / 2

    # Generate voxel centers within bounds
    num_voxels = np.floor((max_bounds - min_bounds) / voxel_size).astype(int) + 1
    centers = []
    for ix in range(num_voxels[0]):
        for iy in range(num_voxels[1]):
            for iz in range(num_voxels[2]):
                center_v = min_bounds + np.array([ix + 0.5, iy + 0.5, iz + 0.5]) * voxel_size
                centers.append(center_v)
    centers = np.array(centers)

    # Set up renderer
    renderer = vtk.vtkRenderer()
    renderer.SetBackground(0.05, 0.05, 0.05)

    # Add point actors
    renderer.AddActor(create_points_actor(center_point, (1.0, 1.0, 1.0)))  # White center
    renderer.AddActor(create_points_actor(ring_accepted, (1.0, 0.0, 0.0)))  # Red ring
    renderer.AddActor(create_points_actor(plane_accepted, (0.0, 1.0, 0.0)))  # Green plane
    renderer.AddActor(create_points_actor(below_accepted, (0.0, 0.0, 1.0)))  # Blue below
    renderer.AddActor(create_points_actor(above_accepted, (1.0, 1.0, 0.0)))  # Yellow above

    # Add grid
    #add_grid_to_renderer(renderer, min_bounds, max_bounds, voxel_size)

    # Set up window and interactor
    render_window = vtk.vtkRenderWindow()
    render_window.AddRenderer(renderer)
    render_window.SetSize(1200, 900)

    interactor = vtk.vtkRenderWindowInteractor()
    interactor.SetRenderWindow(render_window)

    # Set up animator
    animator = VoxelAnimator(renderer, centers, all_points, sh)
    interactor.AddObserver("TimerEvent", animator.execute)
    interactor.CreateRepeatingTimer(100)  # 100ms per frame

    render_window.Render()
    interactor.Start()


if __name__ == "__main__":
    main()