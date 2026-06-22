// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/WGTToken.sol";
import "../src/ItemShop.sol";

contract Deploy is Script {
    function run() external {
        address admin = vm.envAddress("ADMIN_ADDRESS");
        address minter = vm.envAddress("MINTER_ADDRESS");

        vm.startBroadcast();

        WGTToken token = new WGTToken(admin);
        token.grantRole(token.MINTER_ROLE(), minter);

        ItemShop shop = new ItemShop(address(token), admin);

        // Items del lanzamiento: precio 1 WGT, cantidad 5
        shop.addItem(1, 1e18, 5); // Refuerzos Extra
        shop.addItem(2, 1e18, 5); // Doble Ataque
        shop.addItem(3, 1e18, 5); // Escudo

        vm.stopBroadcast();

        console.log("WGTToken:", address(token));
        console.log("ItemShop:", address(shop));
    }
}
