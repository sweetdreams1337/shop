using System.Text;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.FileProviders;
using Microsoft.IdentityModel.Tokens;
using Shop.Api;

var builder = WebApplication.CreateBuilder(args);

// Chuỗi kết nối Supabase: biến môi trường DATABASE_URL, user-secrets hoặc appsettings.Development.json
var raw = builder.Configuration["DATABASE_URL"] ?? builder.Configuration.GetConnectionString("Default");
if (string.IsNullOrWhiteSpace(raw))
{
    Console.Error.WriteLine("Thiếu DATABASE_URL. Xem README-DOTNET.md để cấu hình chuỗi kết nối Supabase.");
    return 1;
}

var secret = builder.Configuration["JWT_SECRET"] ?? "dev-secret-change-me-dev-secret-change-me";
Api.Key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret));

builder.Services.ConfigureHttpJsonOptions(o =>
{
    o.SerializerOptions.NumberHandling = JsonNumberHandling.AllowReadingFromString;
    o.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.Never;
});
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()));
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(o =>
{
    o.MapInboundClaims = false;
    o.TokenValidationParameters = new TokenValidationParameters
    {
        IssuerSigningKey = Api.Key,
        ValidateIssuer = false,
        ValidateAudience = false,
        RoleClaimType = "role",
        NameClaimType = "id",
    };
});
builder.Services.AddAuthorizationBuilder()
    .AddPolicy("admin", p => p.RequireAuthenticatedUser().RequireClaim("role", "admin"));

var db = new Db(raw);
builder.Services.AddSingleton(db);

var app = builder.Build();

app.Use(async (ctx, next) =>
{
    try { await next(); }
    catch (ApiException e)
    {
        ctx.Response.StatusCode = e.Status;
        await ctx.Response.WriteAsJsonAsync(new { error = e.Message });
    }
    catch (BadHttpRequestException)
    {
        ctx.Response.StatusCode = 400;
        await ctx.Response.WriteAsJsonAsync(new { error = "Dữ liệu gửi lên không hợp lệ" });
    }
    catch (Exception e)
    {
        app.Logger.LogError(e, "Lỗi máy chủ");
        ctx.Response.StatusCode = 500;
        await ctx.Response.WriteAsJsonAsync(new { error = "Lỗi máy chủ" });
    }
});

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

await db.Init();
Api.Map(app);

// Nếu đã build frontend (client/dist) thì phục vụ luôn, mở http://localhost:3001 là dùng được cả web
var dist = Path.GetFullPath(Path.Combine(app.Environment.ContentRootPath, "..", "client", "dist"));
if (Directory.Exists(dist))
{
    var fp = new PhysicalFileProvider(dist);
    app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = fp });
    app.UseStaticFiles(new StaticFileOptions { FileProvider = fp });
    app.MapFallbackToFile("index.html", new StaticFileOptions { FileProvider = fp });
}

app.Run();
return 0;
