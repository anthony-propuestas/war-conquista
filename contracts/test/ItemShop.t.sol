// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/WGTToken.sol";
import "../src/ItemShop.sol";

contract ItemShopTest is Test {
    WGTToken token;
    ItemShop shop;
    address admin = address(1);
    address minter = address(2);
    address player = address(3);

    uint256 constant ITEM_ID = 1;
    uint256 constant ITEM_PRICE = 1e18; // 1 WGT
    uint256 constant ITEM_QTY = 5;

    function setUp() public {
        token = new WGTToken(admin);
        shop = new ItemShop(address(token), admin);

        vm.startPrank(admin);
        token.grantRole(token.MINTER_ROLE(), minter);
        shop.addItem(ITEM_ID, ITEM_PRICE, ITEM_QTY);
        vm.stopPrank();
    }

    function test_BuyItemEmitsEvent() public {
        vm.prank(minter);
        token.mint(player, 5e18);

        vm.startPrank(player);
        token.approve(address(shop), ITEM_PRICE);

        vm.expectEmit(true, true, false, true);
        emit ItemShop.ItemPurchased(player, ITEM_ID, ITEM_QTY, block.timestamp);
        shop.buyItem(ITEM_ID);
        vm.stopPrank();

        assertEq(token.balanceOf(player), 4e18); // 5 - 1 burned
    }

    function test_BuyItemBurnsWGT() public {
        vm.prank(minter);
        token.mint(player, 1e18);

        vm.startPrank(player);
        token.approve(address(shop), ITEM_PRICE);
        shop.buyItem(ITEM_ID);
        vm.stopPrank();

        assertEq(token.balanceOf(player), 0);
        assertEq(token.totalSupply(), 0);
    }

    function test_BuyInactiveItemReverts() public {
        vm.prank(admin);
        shop.setItemActive(ITEM_ID, false);

        vm.prank(minter);
        token.mint(player, 1e18);

        vm.startPrank(player);
        token.approve(address(shop), ITEM_PRICE);
        vm.expectRevert("Item no disponible");
        shop.buyItem(ITEM_ID);
        vm.stopPrank();
    }

    function test_BuyWithoutApprovalReverts() public {
        vm.prank(minter);
        token.mint(player, 1e18);

        vm.prank(player);
        vm.expectRevert();
        shop.buyItem(ITEM_ID);
    }

    function test_AddItemRevertIfExists() public {
        vm.prank(admin);
        vm.expectRevert("Item ya existe");
        shop.addItem(ITEM_ID, 2e18, 10);
    }

    function test_OnlyAdminCanAddItem() public {
        vm.prank(player);
        vm.expectRevert();
        shop.addItem(99, 1e18, 5);
    }

    function test_UpdateItem() public {
        vm.prank(admin);
        shop.updateItem(ITEM_ID, 2e18, 10);

        (uint256 price, uint256 qty, bool active) = shop.items(ITEM_ID);
        assertEq(price, 2e18);
        assertEq(qty, 10);
        assertTrue(active);
    }
}
