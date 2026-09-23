"""
LumiIQ v3 - Gaze Stabilization Filters
Multi-layer stabilization: Kalman Filter, One Euro Filter, EMA smoothing
"""
import numpy as np
from collections import deque
from datetime import datetime
from typing import Tuple
import logging

logger = logging.getLogger(__name__)


class KalmanFilter1D:
    """1D Kalman Filter for gaze coordinate smoothing"""
    
    def __init__(self, process_variance: float = 0.01, measurement_variance: float = 0.01,
                 initial_value: float = 0.0, initial_estimate_error: float = 1.0):
        """
        Initialize Kalman Filter
        
        Args:
            process_variance: How much the state can change between steps (Q)
            measurement_variance: How much we trust measurements (R)
            initial_value: Initial state
            initial_estimate_error: Initial estimation error (P)
        """
        self.process_variance = process_variance
        self.measurement_variance = measurement_variance
        self.estimate = initial_value
        self.estimate_error = initial_estimate_error
    
    def update(self, measurement: float) -> float:
        """
        Kalman filter update step
        
        Args:
            measurement: Raw measurement value
            
        Returns:
            Filtered estimate
        """
        # Prediction step
        prediction = self.estimate
        prediction_error = self.estimate_error + self.process_variance
        
        # Update step
        kalman_gain = prediction_error / (prediction_error + self.measurement_variance)
        self.estimate = prediction + kalman_gain * (measurement - prediction)
        self.estimate_error = (1 - kalman_gain) * prediction_error
        
        return self.estimate


class OneEuroFilter:
    """
    One Euro Filter - Low-latency filter for 2D gaze points
    Based on "1€ Filter: A Simple Speed-based Low-pass Filter for Noisy Input in Interactive Systems"
    """
    
    def __init__(self, fcmin: float = 1.0, beta: float = 0.1, dcutoff: float = 1.0):
        """
        Initialize One Euro Filter
        
        Args:
            fcmin: Minimum cutoff frequency (Hz)
            beta: Cutoff slope parameter
            dcutoff: Cutoff frequency for derivative (Hz)
        """
        self.fcmin = fcmin
        self.beta = beta
        self.dcutoff = dcutoff
        
        self.last_timestamp = None
        self.filtered_position = None
        self.filtered_velocity = None
    
    def _compute_alpha(self, fc: float, dt: float) -> float:
        """Compute alpha parameter for low-pass filter"""
        r = 2 * np.pi * fc * dt
        return r / (r + 1)
    
    def update(self, raw_point: Tuple[float, float], timestamp: datetime = None) -> Tuple[float, float]:
        """
        Apply One Euro Filter to gaze point
        
        Args:
            raw_point: (x, y) raw gaze coordinates
            timestamp: Timestamp of measurement
            
        Returns:
            (filtered_x, filtered_y) smoothed coordinates
        """
        if timestamp is None:
            timestamp = datetime.utcnow()
        
        # Initialize on first call
        if self.last_timestamp is None:
            self.last_timestamp = timestamp
            self.filtered_position = np.array(raw_point, dtype=np.float32)
            self.filtered_velocity = np.array([0.0, 0.0], dtype=np.float32)
            return tuple(self.filtered_position)
        
        # Calculate dt
        dt = (timestamp - self.last_timestamp).total_seconds()
        if dt <= 0:
            return tuple(self.filtered_position)
        
        self.last_timestamp = timestamp
        
        # Convert to numpy array
        raw_pos = np.array(raw_point, dtype=np.float32)
        
        # Estimate velocity
        velocity = (raw_pos - self.filtered_position) / dt
        
        # Filter velocity
        alpha_velocity = self._compute_alpha(self.dcutoff, dt)
        self.filtered_velocity = alpha_velocity * velocity + (1 - alpha_velocity) * self.filtered_velocity
        
        # Adaptive cutoff frequency based on velocity
        velocity_magnitude = np.linalg.norm(self.filtered_velocity)
        fc = self.fcmin + self.beta * velocity_magnitude
        
        # Filter position
        alpha_position = self._compute_alpha(fc, dt)
        self.filtered_position = alpha_position * raw_pos + (1 - alpha_position) * self.filtered_position
        
        return tuple(self.filtered_position)


class ExponentialMovingAverage:
    """EMA smoothing for gaze coordinates"""
    
    def __init__(self, alpha: float = 0.2):
        """
        Initialize EMA filter
        
        Args:
            alpha: Smoothing factor (0-1, higher = more responsive)
        """
        self.alpha = alpha
        self.ema_x = None
        self.ema_y = None
    
    def update(self, point: Tuple[float, float]) -> Tuple[float, float]:
        """
        Apply EMA smoothing
        
        Args:
            point: (x, y) raw gaze coordinates
            
        Returns:
            (smoothed_x, smoothed_y)
        """
        if self.ema_x is None:
            self.ema_x = point[0]
            self.ema_y = point[1]
        else:
            self.ema_x = self.alpha * point[0] + (1 - self.alpha) * self.ema_x
            self.ema_y = self.alpha * point[1] + (1 - self.alpha) * self.ema_y
        
        return (self.ema_x, self.ema_y)


class GazeStabilizer:
    """
    Multi-layer gaze stabilization system
    Combines Kalman + One Euro Filter + EMA for professional-grade smoothing
    """
    
    def __init__(self, enable_kalman: bool = True, enable_one_euro: bool = True,
                 enable_ema: bool = True, ema_alpha: float = 0.15):
        """
        Initialize gaze stabilizer
        
        Args:
            enable_kalman: Enable Kalman filter layer
            enable_one_euro: Enable One Euro filter layer
            enable_ema: Enable EMA layer
            ema_alpha: EMA smoothing factor
        """
        self.enable_kalman = enable_kalman
        self.enable_one_euro = enable_one_euro
        self.enable_ema = enable_ema
        
        # Initialize filters
        if enable_kalman:
            self.kalman_x = KalmanFilter1D(process_variance=0.001, measurement_variance=0.01)
            self.kalman_y = KalmanFilter1D(process_variance=0.001, measurement_variance=0.01)
        
        if enable_one_euro:
            self.one_euro = OneEuroFilter(fcmin=1.0, beta=0.1)
        
        if enable_ema:
            self.ema = ExponentialMovingAverage(alpha=ema_alpha)
        
        # Noise rejection
        self.last_point = None
        self.max_jump_distance = 0.1  # Max 10% of screen
        self.jitter_threshold = 0.002  # 0.2% screen movement
        
        # Statistics
        self.points_processed = 0
        self.points_rejected = 0
    
    def update(self, raw_point: Tuple[float, float], timestamp: datetime = None) -> Tuple[float, float]:
        """
        Apply all stabilization layers to gaze point
        
        Args:
            raw_point: (x, y) raw gaze coordinates (0-1 normalized)
            timestamp: Timestamp of measurement
            
        Returns:
            (stabilized_x, stabilized_y) smoothed and validated coordinates
        """
        if timestamp is None:
            timestamp = datetime.utcnow()
        
        self.points_processed += 1
        
        # Clamp to valid range
        raw_point = (np.clip(raw_point[0], 0.0, 1.0), np.clip(raw_point[1], 0.0, 1.0))
        
        # Outlier rejection - detect sudden large jumps
        if self.last_point is not None:
            distance = np.sqrt((raw_point[0] - self.last_point[0])**2 + 
                             (raw_point[1] - self.last_point[1])**2)
            
            if distance > self.max_jump_distance:
                logger.debug(f"Outlier detected: jump distance {distance:.3f}")
                self.points_rejected += 1
                # Use last valid point instead
                raw_point = self.last_point
        
        point = raw_point
        
        # Layer 1: Kalman Filter (reduces noise)
        if self.enable_kalman:
            point_x = self.kalman_x.update(point[0])
            point_y = self.kalman_y.update(point[1])
            point = (point_x, point_y)
        
        # Layer 2: One Euro Filter (speed-adaptive smoothing)
        if self.enable_one_euro:
            point = self.one_euro.update(point, timestamp)
        
        # Layer 3: EMA (micro-jitter suppression)
        if self.enable_ema:
            point = self.ema.update(point)
        
        # Micro-jitter suppression: if movement is very small, stay put
        if self.last_point is not None:
            distance = np.sqrt((point[0] - self.last_point[0])**2 + 
                             (point[1] - self.last_point[1])**2)
            if distance < self.jitter_threshold:
                point = self.last_point
        
        self.last_point = point
        
        return point
    
    def reset(self):
        """Reset all filters"""
        if self.enable_kalman:
            self.kalman_x = KalmanFilter1D()
            self.kalman_y = KalmanFilter1D()
        if self.enable_one_euro:
            self.one_euro = OneEuroFilter()
        if self.enable_ema:
            self.ema = ExponentialMovingAverage()
        self.last_point = None
    
    def get_stats(self) -> dict:
        """Get filter statistics"""
        rejection_rate = (self.points_rejected / self.points_processed * 100 
                         if self.points_processed > 0 else 0)
        return {
            'points_processed': self.points_processed,
            'points_rejected': self.points_rejected,
            'rejection_rate': rejection_rate
        }
