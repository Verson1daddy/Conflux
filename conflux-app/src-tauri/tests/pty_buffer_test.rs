// ===== OutputBuffer 单元测试 =====
//
// 测试环形缓冲区的核心行为:
// - 基本写入/读取
// - 环绕覆盖（写入超过容量）
// - read_last 部分读取
// - clear 重置
// - 空缓冲区边界情况

use conflux_lib::pty::buffer::OutputBuffer;

// ===== 基本功能测试 =====

#[test]
fn test_new_buffer_is_empty() {
    let buf = OutputBuffer::new(1024);
    assert!(buf.is_empty());
    assert_eq!(buf.len(), 0);
    assert_eq!(buf.total_written(), 0);
    assert_eq!(buf.read_all(), Vec::<u8>::new());
}

#[test]
fn test_basic_write_and_read_all() {
    let mut buf = OutputBuffer::new(1024);
    let data = b"hello world";
    buf.write(data);

    assert_eq!(buf.len(), 11);
    assert_eq!(buf.total_written(), 11);
    assert!(!buf.is_empty());
    assert_eq!(buf.read_all(), data.to_vec());
}

#[test]
fn test_multiple_writes() {
    let mut buf = OutputBuffer::new(1024);
    buf.write(b"hello ");
    buf.write(b"world");

    assert_eq!(buf.len(), 11);
    assert_eq!(buf.total_written(), 11);
    assert_eq!(buf.read_all(), b"hello world".to_vec());
}

#[test]
fn test_write_empty_data() {
    let mut buf = OutputBuffer::new(1024);
    buf.write(b"");
    assert!(buf.is_empty());
    assert_eq!(buf.len(), 0);

    buf.write(b"data");
    buf.write(b"");
    assert_eq!(buf.len(), 4);
    assert_eq!(buf.read_all(), b"data".to_vec());
}

// ===== 环绕测试 =====

#[test]
fn test_wrap_around_single_large_write() {
    // 容量 10 字节，写入 15 字节——只保留最后 10 字节
    let mut buf = OutputBuffer::new(10);
    buf.write(b"0123456789ABCDE");

    assert_eq!(buf.len(), 10);
    assert_eq!(buf.total_written(), 15);
    assert_eq!(buf.read_all(), b"56789ABCDE".to_vec());
}

#[test]
fn test_wrap_around_incremental_writes() {
    // 容量 10 字节，分多次写入超过容量
    let mut buf = OutputBuffer::new(10);
    buf.write(b"ABCDEFGH"); // 8 字节，write_pos=8
    buf.write(b"IJKL");     // 4 字节，发生环绕，write_pos=2

    assert_eq!(buf.len(), 10);
    assert_eq!(buf.total_written(), 12);
    // 有效数据: CDEFGHIJKL（最旧的 AB 被覆盖）
    assert_eq!(buf.read_all(), b"CDEFGHIJKL".to_vec());
}

#[test]
fn test_wrap_around_exact_capacity() {
    // 写入恰好等于容量
    let mut buf = OutputBuffer::new(5);
    buf.write(b"ABCDE");

    assert_eq!(buf.len(), 5);
    assert_eq!(buf.total_written(), 5);
    assert_eq!(buf.read_all(), b"ABCDE".to_vec());
}

#[test]
fn test_wrap_around_double_capacity() {
    // 单次写入为容量的 2 倍——只保留最后 capacity 字节
    let mut buf = OutputBuffer::new(5);
    buf.write(b"0123456789");

    assert_eq!(buf.len(), 5);
    assert_eq!(buf.total_written(), 10);
    assert_eq!(buf.read_all(), b"56789".to_vec());
}

#[test]
fn test_multiple_wrap_arounds() {
    // 容量 4，多次环绕
    let mut buf = OutputBuffer::new(4);
    buf.write(b"ABCD"); // 填满
    buf.write(b"EF");   // 覆盖 AB
    buf.write(b"GH");   // 覆盖 CD

    assert_eq!(buf.len(), 4);
    assert_eq!(buf.total_written(), 8);
    assert_eq!(buf.read_all(), b"EFGH".to_vec());
}

// ===== read_last 测试 =====

#[test]
fn test_read_last_no_wrap() {
    let mut buf = OutputBuffer::new(1024);
    buf.write(b"hello world");

    assert_eq!(buf.read_last(5), b"world".to_vec());
    assert_eq!(buf.read_last(11), b"hello world".to_vec());
    // 请求超过有效数据长度
    assert_eq!(buf.read_last(100), b"hello world".to_vec());
}

#[test]
fn test_read_last_with_wrap() {
    let mut buf = OutputBuffer::new(10);
    buf.write(b"ABCDEFGH"); // write_pos=8
    buf.write(b"IJKL");     // 环绕，write_pos=2

    // 有效数据: CDEFGHIJKL
    assert_eq!(buf.read_last(4), b"IJKL".to_vec());
    assert_eq!(buf.read_last(6), b"GHIJKL".to_vec());
    assert_eq!(buf.read_last(10), b"CDEFGHIJKL".to_vec());
}

#[test]
fn test_read_last_zero() {
    let mut buf = OutputBuffer::new(1024);
    buf.write(b"data");
    assert_eq!(buf.read_last(0), Vec::<u8>::new());
}

#[test]
fn test_read_last_empty_buffer() {
    let buf = OutputBuffer::new(1024);
    assert_eq!(buf.read_last(10), Vec::<u8>::new());
}

// ===== clear 测试 =====

#[test]
fn test_clear() {
    let mut buf = OutputBuffer::new(1024);
    buf.write(b"some data here");

    assert!(!buf.is_empty());
    buf.clear();

    assert!(buf.is_empty());
    assert_eq!(buf.len(), 0);
    assert_eq!(buf.total_written(), 0);
    assert_eq!(buf.read_all(), Vec::<u8>::new());
}

#[test]
fn test_write_after_clear() {
    let mut buf = OutputBuffer::new(10);
    buf.write(b"0123456789AB"); // 环绕
    buf.clear();
    buf.write(b"NEW");

    assert_eq!(buf.len(), 3);
    assert_eq!(buf.total_written(), 3);
    assert_eq!(buf.read_all(), b"NEW".to_vec());
}

// ===== 边界情况 =====

#[test]
fn test_capacity_one() {
    let mut buf = OutputBuffer::new(1);
    buf.write(b"A");
    assert_eq!(buf.read_all(), b"A".to_vec());

    buf.write(b"B");
    assert_eq!(buf.len(), 1);
    assert_eq!(buf.read_all(), b"B".to_vec());
}

#[test]
fn test_capacity_zero_promoted_to_one() {
    // 容量 0 会被强制设为 1
    let mut buf = OutputBuffer::new(0);
    buf.write(b"X");
    assert_eq!(buf.len(), 1);
    assert_eq!(buf.read_all(), b"X".to_vec());
}

#[test]
fn test_large_data_write() {
    let capacity = 1024;
    let mut buf = OutputBuffer::new(capacity);

    // 写入大量数据
    let data: Vec<u8> = (0..5000).map(|i| (i % 256) as u8).collect();
    buf.write(&data);

    assert_eq!(buf.len(), capacity);
    assert_eq!(buf.total_written(), 5000);

    // 最后 capacity 字节应该是 data 的最后 1024 字节
    let expected = &data[data.len() - capacity..];
    assert_eq!(buf.read_all(), expected.to_vec());
}

#[test]
fn test_read_last_equals_read_all_when_n_ge_len() {
    let mut buf = OutputBuffer::new(10);
    buf.write(b"ABCDEFGHIJKLMN"); // 环绕

    let all = buf.read_all();
    let last_big = buf.read_last(1000);
    assert_eq!(all, last_big);
}
