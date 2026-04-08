// ===== Conflux PTY 输出环形缓冲区 =====
//
// 策略:
// - 固定容量（默认 1MB = 1_048_576 字节），超出后丢弃最旧数据
// - 支持追加写入和范围读取
// - 线程安全由外部 RwLock 保证（PtyProcess.buffer: Arc<RwLock<OutputBuffer>>）
//
// 环绕逻辑:
//   当 total_written <= capacity 时，data[0..write_pos] 包含所有有效数据
//   当 total_written > capacity 时，缓冲区已满并发生环绕:
//     write_pos 指向下一个写入位置（也是最旧数据的位置）
//     有效数据从 data[write_pos..capacity] + data[0..write_pos]

/// 默认缓冲区容量：1MB
pub const DEFAULT_BUFFER_CAPACITY: usize = 1_048_576;

/// 环形输出缓冲区
///
/// 用于存储 PTY 进程的原始输出数据。
/// 当写入数据超过容量时，自动覆盖最旧的数据（环形覆盖策略）。
pub struct OutputBuffer {
    /// 内部缓冲区
    data: Vec<u8>,
    /// 最大容量（字节）
    capacity: usize,
    /// 写入头位置（下一次写入的起始位置，范围 0..capacity）
    write_pos: usize,
    /// 总写入字节数（用于判断是否发生了环绕）
    total_written: u64,
}

impl OutputBuffer {
    /// 创建指定容量的缓冲区
    ///
    /// # Arguments
    /// * `capacity` - 缓冲区最大字节数，0 会被强制设为 1 以避免除零
    pub fn new(capacity: usize) -> Self {
        let capacity = if capacity == 0 { 1 } else { capacity };
        Self {
            data: vec![0u8; capacity],
            capacity,
            write_pos: 0,
            total_written: 0,
        }
    }

    /// 向缓冲区追加数据
    ///
    /// 如果数据长度超过缓冲区容量，仅保留最后 capacity 字节。
    /// 写入过程中可能发生环绕——数据尾部从 data[0] 继续写入。
    pub fn write(&mut self, data: &[u8]) {
        if data.is_empty() {
            return;
        }

        // 如果写入数据比整个缓冲区还大，只保留最后 capacity 字节
        let src = if data.len() > self.capacity {
            &data[data.len() - self.capacity..]
        } else {
            data
        };

        let src_len = src.len();
        let remaining = self.capacity - self.write_pos;

        if src_len <= remaining {
            // 不需要环绕——直接拷贝
            self.data[self.write_pos..self.write_pos + src_len].copy_from_slice(src);
        } else {
            // 需要环绕——分两段拷贝
            self.data[self.write_pos..self.write_pos + remaining]
                .copy_from_slice(&src[..remaining]);
            let overflow = src_len - remaining;
            self.data[..overflow].copy_from_slice(&src[remaining..]);
        }

        self.write_pos = (self.write_pos + src_len) % self.capacity;
        self.total_written += data.len() as u64; // 记录原始完整长度
    }

    /// 读取所有有效数据
    ///
    /// 返回按时间顺序排列的完整有效数据：最旧的在前，最新的在后。
    pub fn read_all(&self) -> Vec<u8> {
        let valid_len = self.len();
        if valid_len == 0 {
            return Vec::new();
        }

        if self.total_written <= self.capacity as u64 {
            // 未发生环绕——data[0..write_pos] 就是全部有效数据
            self.data[..self.write_pos].to_vec()
        } else {
            // 已发生环绕——从 write_pos 开始读到末尾，再从 0 读到 write_pos
            let mut result = Vec::with_capacity(self.capacity);
            result.extend_from_slice(&self.data[self.write_pos..]);
            result.extend_from_slice(&self.data[..self.write_pos]);
            result
        }
    }

    /// 读取最后 n 字节
    ///
    /// 如果 n 大于当前有效数据长度，返回所有有效数据。
    pub fn read_last(&self, n: usize) -> Vec<u8> {
        let valid_len = self.len();
        if n == 0 || valid_len == 0 {
            return Vec::new();
        }

        let n = n.min(valid_len);

        if self.total_written <= self.capacity as u64 {
            // 未环绕——从 write_pos 往前取 n 字节
            self.data[self.write_pos - n..self.write_pos].to_vec()
        } else {
            // 已环绕——最新数据在 write_pos 之前
            if n <= self.write_pos {
                // 最后 n 字节全在 [0..write_pos] 范围内
                self.data[self.write_pos - n..self.write_pos].to_vec()
            } else {
                // 需要跨越环绕边界
                let from_end = n - self.write_pos;
                let mut result = Vec::with_capacity(n);
                result.extend_from_slice(&self.data[self.capacity - from_end..]);
                result.extend_from_slice(&self.data[..self.write_pos]);
                result
            }
        }
    }

    /// 当前有效数据长度（字节）
    pub fn len(&self) -> usize {
        if self.total_written <= self.capacity as u64 {
            self.total_written as usize
        } else {
            self.capacity
        }
    }

    /// 缓冲区是否为空
    pub fn is_empty(&self) -> bool {
        self.total_written == 0
    }

    /// 累计写入总字节数（包含已被覆盖的部分）
    pub fn total_written(&self) -> u64 {
        self.total_written
    }

    /// 清空缓冲区，重置所有状态
    pub fn clear(&mut self) {
        self.write_pos = 0;
        self.total_written = 0;
        // 不需要清零 data 内容——write_pos 和 total_written 已经标记为空
    }
}
