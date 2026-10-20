use json2obj_core::generate;

fn main() {
    let input = r#"{"id":1,"name":"Ada","role":"admin","tags":["x"],"profile":{"city":"SH"}}
{"id":2,"name":"Bob","role":"user","tags":["y","z"],"profile":{"city":"BJ","age":30}}
{"id":3,"name":"Cara","role":"admin","tags":[],"profile":{"city":"SZ"},"deleted_at":null}
{"id":4,"name":"Ada","role":"guest","tags":["x"],"profile":{"city":"SH","age":28}}
{"id":5,"name":"Bob","role":"admin","tags":["z"],"profile":{"city":"BJ"}}
{"id":6,"name":"Ada","role":"user","tags":[],"profile":{"city":"HZ","age":31}}"#;

    let out = generate(input, "User", true).unwrap();
    println!("{}", out.typescript);
    println!("{}", out.zod);
    println!("{:?}", out.stats);
}
